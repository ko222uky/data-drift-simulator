"""Credential checks, token handling and login throttling."""

import hmac
import threading
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

import jwt

from .config import AuthSettings

ALGORITHM = "HS256"
ISSUER = "mlops-demo-auth"


def check_credentials(settings: AuthSettings, username: str, password: str) -> bool:
    # Compare both fields in constant time and always evaluate both.
    user_ok = hmac.compare_digest(username.encode(), settings.admin_username.encode())
    pass_ok = hmac.compare_digest(password.encode(), settings.admin_password.get_secret_value().encode())
    return user_ok and pass_ok


def issue_token(settings: AuthSettings, username: str) -> tuple[str, int]:
    now = datetime.now(UTC)
    ttl = timedelta(minutes=settings.token_ttl_minutes)
    claims = {"sub": username, "iat": now, "exp": now + ttl, "iss": ISSUER}
    token = jwt.encode(claims, settings.jwt_secret.get_secret_value(), algorithm=ALGORITHM)
    return token, int(ttl.total_seconds())


def verify_token(settings: AuthSettings, token: str) -> str | None:
    """Return the subject of a valid token, or None."""
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[ALGORITHM],
            issuer=ISSUER,
            options={"require": ["exp", "sub", "iss"]},
        )
    except jwt.PyJWTError:
        return None
    return claims["sub"]


class LoginThrottle:
    """Lock a client out after too many failed logins inside a sliding window."""

    def __init__(self, max_failures: int, window_seconds: float):
        self.max_failures = max_failures
        self.window = window_seconds
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        attempts = self._failures[key]
        while attempts and now - attempts[0] > self.window:
            attempts.popleft()
        return attempts

    def is_locked(self, key: str) -> bool:
        with self._lock:
            return len(self._prune(key, time.monotonic())) >= self.max_failures

    def record_failure(self, key: str) -> None:
        with self._lock:
            now = time.monotonic()
            self._prune(key, now).append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
