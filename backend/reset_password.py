
from getpass import getpass
from app.database import SessionLocal
from app.models import User
from app.security import hash_password

db = SessionLocal()

try:
    user = db.query(User).filter(
        User.email == "smartqueue.demo@gmail.com"
    ).first()

    if not user:
        print("Account not found.")
    else:
        new_password = input("Enter your NEW password: ")
        confirm_password = input("Confirm your NEW password: ")

        if new_password != confirm_password:
            print("Passwords do not match. Nothing changed.")
        elif len(new_password) < 8:
            print("Use at least 8 characters. Nothing changed.")
        elif len(new_password.encode("utf-8")) > 72:
            print("Password is too long. Use at most 72 UTF-8 bytes.")
        else:
            user.password_hash = hash_password(new_password)
            db.commit()
            print("SUCCESS: Password updated!")
finally:
    db.close()
