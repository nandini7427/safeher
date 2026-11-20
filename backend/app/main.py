
import secrets
import uuid
from pathlib import Path
import json
import math
import urllib.request
import urllib.parse

from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, TimeoutError

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc

from .config import settings
from .database import Base, engine, get_db, SessionLocal
from .models import User, EmergencyContact, Incident, LocationUpdate, Evidence
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
from .email_service import send_emergency_emails


# --------------------------------------------------
# EVIDENCE STORAGE CONFIGURATION
# --------------------------------------------------

EVIDENCE_DIR = Path(__file__).resolve().parent.parent / "evidence_storage"
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

MAX_EVIDENCE_BYTES = 100 * 1024 * 1024

ALLOWED_EVIDENCE_TYPES = {
    "video/webm",
    "audio/webm",
    "video/mp4",
    "audio/mp4",
}

Base.metadata.create_all(bind=engine)

app = FastAPI(title="SafeHer API", version="0.4.0")


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
    Find up to three nearest mapped police stations.

    Search radii:
    1. 5 km
    2. 10 km
    3. 20 km

    Multiple Overpass servers are attempted if a server
    fails or returns no stations.
    """

    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        print("Invalid GPS coordinates supplied for police lookup.")
        return []

    overpass_servers = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
    ]

    search_radii = [5000, 10000, 20000]

    for radius in search_radii:

        query = f"""
        [out:json][timeout:25];
        (
          node["amenity"="police"](around:{radius},{latitude},{longitude});
          way["amenity"="police"](around:{radius},{latitude},{longitude});
          relation["amenity"="police"](around:{radius},{latitude},{longitude});
        );
        out center tags;
        """

        for url in overpass_servers:

            try:
                print(
                    f"Police lookup: radius {radius}m, server {url}"
                )

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

                with urllib.request.urlopen(req, timeout=30) as response:
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
                        station_lat = float(element["lat"])
                        station_lon = float(element["lon"])

                    elif element.get("center"):
                        station_lat = float(element["center"]["lat"])
                        station_lon = float(element["center"]["lon"])

                    else:
                        continue

                    if not (
                        -90 <= station_lat <= 90
                        and -180 <= station_lon <= 180
                    ):
                        continue

                    distance = calculate_distance(
                        latitude,
                        longitude,
                        station_lat,
                        station_lon
                    )

                    if distance > radius / 1000:
                        continue

                    name = (
                        tags.get("name")
                        or tags.get("official_name")
                        or "Police station (mapped location)"
                    )

                    address_parts = [
                        tags.get("addr:housenumber"),
                        tags.get("addr:street"),
                        tags.get("addr:suburb"),
                        tags.get("addr:city"),
                        tags.get("addr:state"),
                        tags.get("addr:postcode"),
                    ]

                    address = ", ".join(
                        str(part)
                        for part in address_parts
                        if part
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

                if stations:
                    print(
                        f"Found {len(stations)} mapped police station(s) "
                        f"within {radius} metres."
                    )

                    return stations[:3]

                print(
                    f"No stations returned by {url} "
                    f"within {radius} metres. Trying another source."
                )

            except Exception as error:
                print(
                    f"Police lookup failed on {url}: {error}"
                )

    print(
        "No nearby mapped police stations could be retrieved."
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
# --------------------------------------------------
# SOS EMAIL NOTIFICATION WORKER
# --------------------------------------------------

# Separate worker threads allow police lookup to continue
# without blocking the SOS API response.
_notification_executor = ThreadPoolExecutor(max_workers=2)


def _process_sos_notifications(
    incident_id: int,
    user_name: str,
    recipients: list[dict],
    latitude: float,
    longitude: float,
    accuracy_m: float | None,
    share_url: str,
    maps_url: str
):
    db = SessionLocal()

    try:
        incident = db.query(Incident).filter_by(
            id=incident_id
        ).first()

        if not incident:
            print(f"SOS incident {incident_id} was not found.")
            return

        # Start police lookup concurrently. Do not let a slow
        # OpenStreetMap response delay the emergency email.
        police_future = _notification_executor.submit(
            find_nearby_police_stations,
            latitude,
            longitude
        )

        try:
            police_stations = police_future.result(timeout=2)

        except TimeoutError:
            police_stations = []
            print(
                "Police lookup is taking longer than 2 seconds. "
                "Sending SOS email without unverified station details."
            )

        except Exception as error:
            police_stations = []
            print(f"Police lookup failed: {error}")

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
                    f"Station coordinates: "
                    f"{station['latitude']},{station['longitude']}\n"
                    f"Directions: {station['directions_url']}\n"
                )

        else:
            police_text = (
                "\nNo nearby mapped police station could be "
                "verified before this alert was sent.\n"
                f"Use Google Maps to find a nearby police station: "
                f"{maps_url}\n"
                "Call 112 in India for emergency assistance.\n"
            )

        subject = f"SAFEHER EMERGENCY ALERT - {user_name}"

        body = (
            f"SAFEHER EMERGENCY ALERT\n"
            f"========================\n\n"
            f"{user_name} has activated an SOS alert.\n\n"

            f"CURRENT LOCATION\n"
            f"Latitude: {latitude}\n"
            f"Longitude: {longitude}\n"
            f"Accuracy: {accuracy_m} metres\n"
            f"Google Maps: {maps_url}\n\n"

            f"LIVE LOCATION TRACKING\n"
            f"Open this link to view the latest shared location:\n"
            f"{share_url}\n\n"

            f"NEAREST MAPPED POLICE STATIONS\n"
            f"===============================\n"
            f"{police_text}\n"

            f"EMERGENCY ASSISTANCE\n"
            f"Call 112 in India for emergency assistance.\n\n"

            f"Please contact {user_name} immediately.\n\n"

            f"IMPORTANT:\n"
            f"Police station information is based on available "
            f"OpenStreetMap data and may be incomplete.\n"
            f"Distances are approximate straight-line distances, "
            f"not road travel distances.\n"
            f"This alert does not automatically contact police.\n\n"

            f"This is an automated SafeHer alert."
        )

        results = send_emergency_emails(
            recipients,
            subject,
            body
        )

        if any(item["status"] == "sent" for item in results):
            overall = "sent"

        elif results and all(
            item["status"] == "not_configured"
            for item in results
        ):
            overall = "not_configured"

        else:
            overall = "failed"

        incident.sms_status = overall
        db.commit()

        print(
            f"SOS incident {incident_id}: "
            f"email notification status = {overall}"
        )

    except Exception as error:
        print(
            f"SOS notification worker failed for incident "
            f"{incident_id}: {type(error).__name__}: {error}"
        )

        try:
            incident = db.query(Incident).filter_by(
                id=incident_id
            ).first()

            if incident:
                incident.sms_status = "failed"
                db.commit()
        except Exception:
            db.rollback()

    finally:
        db.close()


# --------------------------------------------------
# ACTIVATE SOS - FAST RESPONSE + BACKGROUND EMAIL
# --------------------------------------------------

@app.post("/api/sos")
def activate_sos(
    data: SOSIn,
    background_tasks: BackgroundTasks,
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
            detail=(
                "Add at least one consenting emergency contact "
                "before activating SOS"
            )
        )

    # Snapshot contact information before the request session closes.
    recipients = [
        {
            "contact_id": contact.id,
            "email": contact.email
        }
        for contact in contacts
    ]

    token = secrets.token_urlsafe(32)

    incident = Incident(
        user_id=user.id,
        share_token=token,
        status="active",
        sms_status="sending"
    )

    db.add(incident)
    db.commit()
    db.refresh(incident)

    # Save the initial GPS location immediately.
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

    # Email and police lookup are processed after the API response.
    background_tasks.add_task(
        _process_sos_notifications,
        incident.id,
        user.name,
        recipients,
        data.latitude,
        data.longitude,
        data.accuracy_m,
        share_url,
        maps_url
    )

    return {
        "incident_id": incident.id,
        "status": "active",
        "email_status": "sending",
        "recipient_results": [],
        "tracking_url": share_url,
        "maps_url": maps_url,
        "police_stations": [],
        "message": (
            "SOS incident created. Emergency contact email "
            "notifications are being processed in the background. "
            "This does not automatically contact police or "
            "emergency services."
        )
    }

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
            "email_status": row.sms_status,
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
# CHECK SOS EMAIL NOTIFICATION STATUS
# --------------------------------------------------

@app.get("/api/incidents/{incident_id}/notification-status")
def notification_status(
    incident_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db)
):

    incident = db.query(Incident).filter_by(
        id=incident_id,
        user_id=user.id
    ).first()

    if not incident:
        raise HTTPException(
            status_code=404,
            detail="Incident not found"
        )

    return {
        "incident_id": incident.id,
        "email_status": incident.sms_status
    }

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


# --------------------------------------------------
# UPLOAD SOS EVIDENCE
# --------------------------------------------------

@app.post("/api/incidents/{incident_id}/evidence", status_code=201)
async def upload_evidence(
    incident_id: int,
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db)
):

    incident = db.query(Incident).filter_by(
        id=incident_id,
        user_id=user.id
    ).first()

    if not incident:
        raise HTTPException(404, "Incident not found")

    content_type = (
        (file.content_type or "").split(";")[0].lower()
    )

    if content_type not in ALLOWED_EVIDENCE_TYPES:
        raise HTTPException(415, "Unsupported evidence format")

    original_filename = Path(
        (file.filename or "evidence.webm").replace("\\", "/")
    ).name[:255]

    stored_filename = f"{uuid.uuid4().hex}.webm"

    destination = EVIDENCE_DIR / stored_filename

    total_size = 0

    try:

        with destination.open("wb") as output:

            while True:

                chunk = await file.read(1024 * 1024)

                if not chunk:
                    break

                total_size += len(chunk)

                if total_size > MAX_EVIDENCE_BYTES:
                    raise HTTPException(
                        413,
                        "Evidence file exceeds the 100 MB limit"
                    )

                output.write(chunk)

        if total_size == 0:
            raise HTTPException(400, "Empty evidence file")

        evidence = Evidence(
            user_id=user.id,
            incident_id=incident.id,
            original_filename=original_filename,
            stored_filename=stored_filename,
            content_type=content_type,
            file_size=total_size
        )

        db.add(evidence)
        db.commit()
        db.refresh(evidence)

        return {
            "id": evidence.id,
            "incident_id": evidence.incident_id,
            "filename": evidence.original_filename,
            "content_type": evidence.content_type,
            "file_size": evidence.file_size,
            "message": "Evidence uploaded successfully"
        }

    except Exception:
        if destination.exists():
            destination.unlink()
        raise

    finally:
        await file.close()


# --------------------------------------------------
# LIST EVIDENCE FOR AN INCIDENT
# --------------------------------------------------

@app.get("/api/incidents/{incident_id}/evidence")
def list_evidence(
    incident_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db)
):

    incident = db.query(Incident).filter_by(
        id=incident_id,
        user_id=user.id
    ).first()

    if not incident:
        raise HTTPException(404, "Incident not found")

    records = db.query(Evidence).filter_by(
        incident_id=incident_id,
        user_id=user.id
    ).order_by(
        desc(Evidence.created_at)
    ).all()

    return [
        {
            "id": item.id,
            "incident_id": item.incident_id,
            "filename": item.original_filename,
            "content_type": item.content_type,
            "file_size": item.file_size,
            "created_at": item.created_at.isoformat()
        }
        for item in records
    ]


# --------------------------------------------------
# DOWNLOAD PRIVATE EVIDENCE
# --------------------------------------------------

@app.get("/api/evidence/{evidence_id}/download")
def download_evidence(
    evidence_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db)
):

    evidence = db.query(Evidence).filter_by(
        id=evidence_id,
        user_id=user.id
    ).first()

    if not evidence:
        raise HTTPException(404, "Evidence not found")

    file_path = EVIDENCE_DIR / evidence.stored_filename

    if not file_path.is_file():
        raise HTTPException(404, "Evidence file is missing")

    return FileResponse(
        path=str(file_path),
        media_type=evidence.content_type,
        filename=evidence.original_filename
    )



