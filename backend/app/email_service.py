import smtplib
import ssl
from email.message import EmailMessage

from .config import settings


def send_emergency_emails(
    recipients: list[dict],
    subject: str,
    body: str
):
    """
    Send emergency emails using one Gmail SMTP connection.
    Returns an individual result for each recipient.
    """

    results = []

    if not settings.email_address or not settings.email_app_password:
        return [
            {
                "contact_id": item["contact_id"],
                "email": item["email"],
                "status": (
                    "missing_email"
                    if not item["email"]
                    else "not_configured"
                )
            }
            for item in recipients
        ]

    eligible = []

    for item in recipients:
        if not item["email"]:
            results.append({
                "contact_id": item["contact_id"],
                "email": None,
                "status": "missing_email"
            })
        else:
            eligible.append(item)

    if not eligible:
        return results

    try:
        context = ssl.create_default_context()

        print("Connecting to Gmail SMTP for SOS notifications...")

        with smtplib.SMTP_SSL(
            "smtp.gmail.com",
            465,
            timeout=30,
            context=context
        ) as server:

            server.login(
                settings.email_address,
                settings.email_app_password.replace(" ", "")
            )

            print("Gmail authentication successful.")

            for item in eligible:
                message = EmailMessage()
                message["From"] = (
                    f"{settings.email_from_name} "
                    f"<{settings.email_address}>"
                )
                message["To"] = item["email"]
                message["Subject"] = subject
                message.set_content(body)

                try:
                    server.send_message(message)

                    status = "sent"
                    print(
                        f"SOS email accepted by SMTP for {item['email']}."
                    )

                except Exception as error:
                    status = "failed"
                    print(
                        f"SOS email failed for {item['email']}: "
                        f"{type(error).__name__}: {error}"
                    )

                results.append({
                    "contact_id": item["contact_id"],
                    "email": item["email"],
                    "status": status
                })

    except Exception as error:
        print(
            f"Gmail connection failed: "
            f"{type(error).__name__}: {error}"
        )

        already_processed = {
            item["contact_id"] for item in results
        }

        for item in eligible:
            if item["contact_id"] not in already_processed:
                results.append({
                    "contact_id": item["contact_id"],
                    "email": item["email"],
                    "status": "failed"
                })

    return results
