
import secrets
from datetime import datetime, timezone

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import desc

from .config import settings
from .database import Base, engine, get_db
from .models import User, EmergencyContact, Incident, LocationUpdate
from .schemas import (
    RegisterIn,
    LoginIn,
    ContactIn,
    ContactOut,
    SOSIn,
    LocationIn,
)
from .security import hash_password, verify_password, create_token
from .deps import current_user
from .email_service import send_emergency_email


Base.metadata.create_all(bind=engine)

app = FastAPI(title="SafeHer API", version="0.2.0")


# CORS CONFIGURATION
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# HEALTH CHECK
@app.get("/health")
def health():
    return {"status": "ok"}


# REGISTER
@app.post("/api/auth/register")
def register(data: RegisterIn, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(
        (User.email == data.email) | (User.phone == data.phone)
    ).first()

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="Email or phone number is already registered"
        )

    user = User(
        name=data.name,
        email=data.email,
        phone=data.phone,
        password_hash=hash_password(data.password)
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "access_token": create_token(user.id),
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "phone": user.phone
        }
    }


# LOGIN
@app.post("/api/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()

    if not user or not verify_password(
        data.password,
        user.password_hash
    ):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password"
        )

    return {
        "access_token": create_token(user.id),
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "phone": user.phone
        }
    }


# CURRENT USER
@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "phone": user.phone
    }


# LIST EMERGENCY CONTACTS
@app.get("/api/contacts", response_model=list[ContactOut])
def list_contacts(
    user: User = Depends(current_user),
    db: Session = Depends(get_db)
):
    return db.query(EmergencyContact).filter_by(
        user_id=user.id
    ).all()


# ADD EMERGENCY CONTACT
@app.post("/api/contacts", response_model=ContactOut)
def add_contact(
    data: ContactIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db)
):
    if not data.consent_confirmed:
        raise HTTPException(
            status_code=400,
            detail="Confirm that this contact agreed to receive emergency alerts"
        )

    if data.phone == user.phone:
        raise HTTPException(
            status_code=400,
            detail="Your own phone number cannot be an emergency contact"
        )

    contact = EmergencyContact(
        user_id=user.id,
        **data.model_dump()
    )

    db.add(contact)
    db.commit()
    db.refresh(contact)

    return contact


# DELETE EMERGENCY CONTACT
@app.delete("/api/contacts/{contact_id}")
def delete_contact(
    contact_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db)
):
    contact = db.query(EmergencyContact).filter_by(
        id=contact_id,
        user_id=user.id
    ).first()

    if not contact:
        raise HTTPException(
            status_code=404,
            detail="Contact not found"
        )

    db.delete(contact)
    db.commit()

    return {"deleted": True}


# ACTIVATE SOS - GMAIL ALERTS
@app.post("/api/sos")
def activate_sos(
    data: SOSIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db)
):
    contacts = db.query(EmergencyContact).filter_by(
        user_id=user.id,
        consent_confirmed=True
    ).all()

    if not contacts:
        raise HTTPException(
            status_code=400,
            detail="Add at least one consenting emergency contact before activating SOS"
        )

    token = secrets.token_urlsafe(32)

    incident = Incident(
        user_id=user.id,
        share_token=token,
        status="active"
    )

    db.add(incident)
    db.commit()
    db.refresh(incident)

    location = LocationUpdate(
        incident_id=incident.id,
        latitude=data.latitude,
        longitude=data.longitude,
        accuracy_m=data.accuracy_m
    )

    db.add(location)
    db.commit()

    share_url = f"{settings.frontend_url}/track/{token}"

    maps_url = (
        f"https://www.google.com/maps?q="
        f"{data.latitude},{data.longitude}"
    )

    subject = f"SAFEHER EMERGENCY ALERT - {user.name}"

    body = (
        f"SAFEHER EMERGENCY ALERT\n\n"
        f"{user.name} has activated an SOS alert.\n\n"
        f"Current location:\n{maps_url}\n\n"
        f"Live location tracking:\n{share_url}\n\n"
        f"Please contact {user.name} immediately.\n"
        f"If there is immediate danger, call 112 in India.\n\n"
        f"This is an automated SafeHer alert."
    )

    results = []

    for contact in contacts:
        if not contact.email:
            status = "missing_email"
        else:
            status, _ = send_emergency_email(
                contact.email,
                subject,
                body
            )

        results.append({
            "contact_id": contact.id,
            "email": contact.email,
            "status": status
        })

    if any(item["status"] == "sent" for item in results):
        overall = "sent"
    elif all(item["status"] == "not_configured" for item in results):
        overall = "not_configured"
    else:
        overall = "failed"

    # Existing database field retained for compatibility
    incident.sms_status = overall
    db.commit()

    return {
        "incident_id": incident.id,
        "status": "active",
        "email_status": overall,
        "recipient_results": results,
        "tracking_url": share_url,
        "maps_url": maps_url,
        "message": (
            "SOS incident created. Email results are shown above. "
            "This does not automatically contact police or emergency services."
        )
    }


# UPDATE LIVE LOCATION
@app.post("/api/incidents/{incident_id}/location")
def update_location(
    incident_id: int,
    data: LocationIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db)
):
    incident = db.query(Incident).filter_by(
        id=incident_id,
        user_id=user.id,
        status="active"
    ).first()

    if not incident:
        raise HTTPException(
            status_code=404,
            detail="Active incident not found"
        )

    location = LocationUpdate(
        incident_id=incident.id,
        latitude=data.latitude,
        longitude=data.longitude,
        accuracy_m=data.accuracy_m
    )

    db.add(location)
    db.commit()

    return {"updated": True}


# STOP SOS
@app.post("/api/incidents/{incident_id}/stop")
def stop_incident(
    incident_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db)
):
    incident = db.query(Incident).filter_by(
        id=incident_id,
        user_id=user.id,
        status="active"
    ).first()

    if not incident:
        raise HTTPException(
            status_code=404,
            detail="Active incident not found"
        )

    incident.status = "ended"
    incident.ended_at = datetime.now(timezone.utc)

    db.commit()

    return {"status": "ended"}


# INCIDENT HISTORY
@app.get("/api/incidents")
def incident_history(
    user: User = Depends(current_user),
    db: Session = Depends(get_db)
):
    rows = db.query(Incident).filter_by(
        user_id=user.id
    ).order_by(
        desc(Incident.created_at)
    ).limit(100).all()

    return [
        {
            "id": row.id,
            "status": row.status,
            "created_at": row.created_at.isoformat(),
            "ended_at": (
                row.ended_at.isoformat()
                if row.ended_at else None
            ),
            "tracking_url": (
                f"{settings.frontend_url}/track/{row.share_token}"
            )
        }
        for row in rows
    ]


# PUBLIC LIVE TRACKING
@app.get("/api/track/{token}")
def public_tracking(
    token: str,
    db: Session = Depends(get_db)
):
    incident = db.query(Incident).filter_by(
        share_token=token,
        status="active"
    ).first()

    if not incident:
        raise HTTPException(
            status_code=404,
            detail="This location-sharing session is no longer active"
        )

    location = db.query(LocationUpdate).filter_by(
        incident_id=incident.id
    ).order_by(
        desc(LocationUpdate.recorded_at)
    ).first()

    if not location:
        raise HTTPException(
            status_code=404,
            detail="No location available yet"
        )

    user = db.get(User, incident.user_id)

    return {
        "name": user.name,
        "latitude": location.latitude,
        "longitude": location.longitude,
        "accuracy_m": location.accuracy_m,
        "updated_at": location.recorded_at.isoformat(),
        "status": incident.status
    }
