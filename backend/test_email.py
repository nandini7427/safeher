from app.config import settings
from app.email_service import send_emergency_email

print("Gmail configured:", bool(settings.email_address))
print("App password configured:", bool(settings.email_app_password))

if settings.email_address and settings.email_app_password:
    status, error = send_emergency_email(
        settings.email_address,
        "SafeHer Gmail Test",
        "This is a test email from SafeHer."
    )
    print("RESULT:", status)
    print("ERROR:", error)
else:
    print("Gmail configuration is missing.")
