from twilio.rest import Client
from .config import settings

def send_emergency_sms(to_number: str, body: str) -> tuple[str, str | None]:
    if not all([settings.twilio_account_sid, settings.twilio_auth_token, settings.twilio_from_number]):
        return "not_configured", None
    try:
        client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
        message = client.messages.create(
            body=body,
            from_=settings.twilio_from_number,
            to=to_number
        )
        return message.status or "queued", message.sid
    except Exception:
        # Do not expose provider credentials or raw provider errors to users.
        return "failed", None
