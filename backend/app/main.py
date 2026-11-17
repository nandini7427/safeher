
import secrets
import json
import math
import urllib.request
import urllib.parse

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

app = FastAPI(title="SafeHer API", version="0.3.0")


# --------------------------------------------------
# CORS CONFIGURATION
# --------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=(
        r"^https?://(localhost|127\.0\.0\.1|10\.24\.233\.119)(:\d+)?$"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# HEALTH CHECK
# --------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


# --------------------------------------------------
# DISTANCE CALCULATION
# --------------------------------------------------

def calculate_distance(lat1, lon1, lat2, lon2):
    radius = 6371

    lat1 = math.radians(lat1)
    lon1 = math.radians(lon1)
    lat2 = math.radians(lat2)
    lon2 = math.radians(lon2)

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1)
        * math.cos(lat2)
        * math.sin(dlon / 2) ** 2
    )

    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return radius * c


# --------------------------------------------------
# FIND NEARBY POLICE STATIONS
# --------------------------------------------------

def find_nearby_police_stations(latitude, longitude):
    """
    Find up to three nearest mapped police stations
    within 5 km using multiple Overpass servers.
    """

    query = f"""
    [out:json][timeout:20];
    (
      node["amenity"="police"](around:5000,{latitude},{longitude});
      way["amenity"="police"](around:5000,{latitude},{longitude});
      relation["amenity"="police"](around:5000,{latitude},{longitude});
    );
    out center tags;
    """

    overpass_servers = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
    ]

    last_error = None

    for url in overpass_servers:
        try:
            print(f"Trying police lookup server: {url}")

            request_data = urllib.parse.urlencode(
                {"data": query}
            ).encode("utf-8")

            req = urllib.request.Request(
                url,
                data=request_data,
                headers={
                    "User-Agent": "SafeHerEmergencyApp/1.0",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                method="POST",
            )

            with urllib.request.urlopen(req, timeout=25) as response:
                result = json.loads(
                    response.read().decode("utf-8")
                )

            stations = []
            seen = set()

            for element in result.get("elements", []):
                element_id = (
                    element.get("type"),
                    element.get("id")
                )

                if element_id in seen:
                    continue

                seen.add(element_id)
                tags = element.get("tags", {})

                if "lat" in element and "lon" in element:
                    station_lat = element["lat"]
                    station_lon = element["lon"]

                elif element.get("center"):
                    station_lat = element["center"]["lat"]
                    station_lon = element["center"]["lon"]

                else:
                    continue

                distance = calculate_distance(
                    latitude,
                    longitude,
                    station_lat,
                    station_lon
                )

                if distance > 5.1:
                    continue

                name = (
                    tags.get("name")
                    or tags.get("official_name")
                    or "Police station"
                )

                address_parts = [
                    tags.get("addr:housenumber"),
                    tags.get("addr:street"),
                    tags.get("addr:suburb"),
                    tags.get("addr:city"),
                ]

                address = ", ".join(
                    part for part in address_parts if part
                )

                if not address:
                    address = "Address not available in map data"

                directions_url = (
                    "https://www.google.com/maps/dir/?api=1"
                    f"&destination={station_lat},{station_lon}"
                )

                stations.append({
                    "name": name,
                    "latitude": station_lat,
                    "longitude": station_lon,
                    "distance_km": round(distance, 2),
                    "address": address,
                    "directions_url": directions_url,
                })

            stations.sort(
                key=lambda item: item["distance_km"]
            )

            print(
                f"Police lookup completed: "
                f"{len(stations)} mapped station(s) found."
            )

            return stations[:3]

        except Exception as error:
            last_error = error
            print(
                f"Police lookup failed on {url}: {error}"
            )

    print(
        f"All police lookup servers failed. Last error: {last_error}"
    )

    return []


# --------------------------------------------------
# REGISTER
# --------------------------------------------------

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


# --------------------------------------------------
# LOGIN
# --------------------------------------------------

@app.post("/api/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)):

    user = db.query(User).filter(
        User.email == data.email
    ).first()

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


# --------------------------------------------------
# CURRENT USER
# --------------------------------------------------

@app.get("/api/me")
def me(user: User = Depends(current_user)):

    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "phone": user.phone
    }


# --------------------------------------------------
# LIST EMERGENCY CONTACTS
# --------------------------------------------------

@app.get("/api/contacts", response_model=list[ContactOut])
def list_contacts(
    user: User = Depends(current_user),
    db: Session = Depends(get_db)
):

    return db.query(EmergencyContact).filter_by(
        user_id=user.id
    ).all()


# --------------------------------------------------
# ADD EMERGENCY CONTACT
# --------------------------------------------------

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


# --------------------------------------------------
# DELETE EMERGENCY CONTACT
# --------------------------------------------------

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


# --------------------------------------------------
# ACTIVATE SOS - GMAIL + LIVE TRACKING + POLICE
# --------------------------------------------------

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

    # Create unique tracking token
    token = secrets.token_urlsafe(32)

    incident = Incident(
        user_id=user.id,
        share_token=token,
        status="active"
    )

    db.add(incident)
    db.commit()
    db.refresh(incident)

    # Save initial GPS location
    location = LocationUpdate(
        incident_id=incident.id,
        latitude=data.latitude,
        longitude=data.longitude,
        accuracy_m=data.accuracy_m
    )

    db.add(location)
    db.commit()

    # Tracking and map links
    share_url = f"{settings.frontend_url}/track/{token}"

    maps_url = (
        f"https://www.google.com/maps?q="
        f"{data.latitude},{data.longitude}"
    )

    # Find nearest mapped police stations
    police_stations = find_nearby_police_stations(
        data.latitude,
        data.longitude
    )

    # Prepare police station information for email
    if police_stations:

        police_text = ""

        for index, station in enumerate(
            police_stations,
            start=1
        ):

            police_text += (
                f"\n{index}. {station['name']}\n"
                f"Distance: {station['distance_km']} km\n"
                f"Address: {station['address']}\n"
                f"Directions: {station['directions_url']}\n"
            )

    else:

        police_text = (
            "\nPolice station information could not be retrieved "
            "at this time.\n"
            "Please use Google Maps or call 112 in India.\n"
        )

    subject = f"SAFEHER EMERGENCY ALERT - {user.name}"

    body = (
        f"SAFEHER EMERGENCY ALERT\n"
        f"========================\n\n"

        f"{user.name} has activated an SOS alert.\n\n"

        f"CURRENT LOCATION\n"
        f"Latitude: {data.latitude}\n"
        f"Longitude: {data.longitude}\n"
        f"Accuracy: {data.accuracy_m} metres\n"
        f"Google Maps: {maps_url}\n\n"

        f"LIVE LOCATION TRACKING\n"
        f"Open this link to view the latest shared location:\n"
        f"{share_url}\n\n"

        f"NEAREST MAPPED POLICE STATIONS\n"
        f"===============================\n"
        f"{police_text}\n"

        f"EMERGENCY ASSISTANCE\n"
        f"Call 112 in India for emergency assistance.\n\n"

        f"Please contact {user.name} immediately.\n\n"

        f"IMPORTANT:\n"
        f"Police station information is based on available "
        f"OpenStreetMap data and may be incomplete.\n"
        f"This alert does not automatically contact police.\n\n"

        f"This is an automated SafeHer alert."
    )

    # Send email to every consenting emergency contact
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

    elif all(
        item["status"] == "not_configured"
        for item in results
    ):
        overall = "not_configured"

    else:
        overall = "failed"

    incident.sms_status = overall
    db.commit()

    return {
        "incident_id": incident.id,
        "status": "active",
        "email_status": overall,
        "recipient_results": results,
        "tracking_url": share_url,
        "maps_url": maps_url,
        "police_stations": police_stations,
        "message": (
            "SOS incident created. Email results are shown above. "
            "This does not automatically contact police or emergency services."
        )
    }


# --------------------------------------------------
# UPDATE LIVE LOCATION
# --------------------------------------------------

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


# --------------------------------------------------
# STOP SOS
# --------------------------------------------------

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


# --------------------------------------------------
# INCIDENT HISTORY
# --------------------------------------------------

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


# --------------------------------------------------
# PUBLIC LIVE TRACKING
# --------------------------------------------------

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
