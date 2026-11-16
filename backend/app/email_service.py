import smtplib
import ssl
from email.message import EmailMessage

from .config import settings


def send_emergency_email(to_email: str, subject: str, body: str):
    if not settings.email_address or not settings.email_app_password:
        return "not_configured", "Gmail credentials are missing"

    message = EmailMessage()
    message["From"] = (
        f"{settings.email_from_name} <{settings.email_address}>"
    )
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)

    try:
        context = ssl.create_default_context()

        print("Connecting to Gmail SMTP...")

        with smtplib.SMTP_SSL(
            "smtp.gmail.com",
            465,
            timeout=30,
            context=context
        ) as server:

            server.set_debuglevel(0)

            print("Connected to Gmail SMTP.")
            print("Authenticating with Gmail...")

            server.login(
                settings.email_address,
                settings.email_app_password.replace(" ", "")
            )

            print("Gmail authentication successful.")

            server.send_message(message)

            print(f"Email successfully sent to {to_email}.")

        return "sent", None

    except Exception as error:
        error_message = f"{type(error).__name__}: {error}"
        print(f"Emergency email failed: {error_message}")
        return "failed", error_message
