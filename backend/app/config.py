from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    jwt_expire_minutes: int = 720
    frontend_url: str = "http://localhost:5173"

    # Gmail configuration
    email_address: str = ""
    email_app_password: str = ""
    email_from_name: str = "SafeHer Emergency Alerts"

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )


settings = Settings()
