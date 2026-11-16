from app.database import SessionLocal
from app.models import User
from app.security import verify_password

db = SessionLocal()
user = db.query(User).filter(
    User.email == "smartqueue.demo@gmail.com"
).first()

print("ACCOUNT FOUND:", bool(user))

if user:
    password = input("Enter password: ")
    print("PASSWORD MATCH:", verify_password(password, user.password_hash))

db.close()