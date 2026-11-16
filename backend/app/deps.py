from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from .database import get_db
from .config import settings
from .models import User

bearer = HTTPBearer(auto_error=False)

def current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db)
):
    if not creds:
        raise HTTPException(401, "Please log in")
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except (JWTError, ValueError, KeyError):
        raise HTTPException(401, "Invalid or expired login session")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(401, "Account not found")
    return user
