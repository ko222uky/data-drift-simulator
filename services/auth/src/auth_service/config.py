from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class AuthSettings(BaseSettings):
    """Read from environment variables prefixed ``AUTH_`` (e.g. ``AUTH_JWT_SECRET``)."""

    model_config = SettingsConfigDict(env_prefix="AUTH_", env_file=".env", extra="ignore")

    admin_username: str = "admin"
    admin_password: SecretStr
    jwt_secret: SecretStr = Field(description="HMAC key for HS256 tokens; at least 32 characters")
    token_ttl_minutes: int = Field(12 * 60, ge=5)
    cookie_name: str = "session"
    cookie_secure: bool = Field(True, description="Set False only for plain-HTTP local development")

    # Simple in-memory brute-force protection, per client IP.
    max_failed_logins: int = 5
    lockout_minutes: int = 15

    def model_post_init(self, _context: object) -> None:
        if len(self.jwt_secret.get_secret_value()) < 32:
            raise ValueError("AUTH_JWT_SECRET must be at least 32 characters")
        if not self.admin_password.get_secret_value():
            raise ValueError("AUTH_ADMIN_PASSWORD must not be empty")
