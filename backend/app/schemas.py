from pydantic import BaseModel, EmailStr, Field


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str = Field(pattern=r"^\+[1-9]\d{7,14}$")
    password: str = Field(min_length=10, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ContactIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str = Field(pattern=r"^\+[1-9]\d{7,14}$")
    email: EmailStr
    consent_confirmed: bool


class ContactOut(BaseModel):
    id: int
    name: str
    phone: str
    email: EmailStr | None = None
    consent_confirmed: bool

    class Config:
        from_attributes = True


class LocationIn(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0, le=100000)


class SOSIn(LocationIn):
    pass
