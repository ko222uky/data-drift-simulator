"""FastAPI application for the auth service.

Endpoints (the gateway exposes them under ``/api/auth``):

* ``POST /login``  -- exchange credentials for a JWT, returned in the body and as an
  HttpOnly cookie (the cookie is what the browser uses; the body is for API clients).
* ``POST /logout`` -- clear the cookie.
* ``GET  /me``     -- who am I (401 if not signed in).
* ``GET  /verify`` -- forward-auth target used by the gateway, never exposed publicly.
  Accepts ``Authorization: Bearer <jwt>`` or the session cookie; 200 + ``X-Auth-User``
  if valid, 401 otherwise.
"""

from fastapi import FastAPI, HTTPException, Request, Response, status
from pydantic import BaseModel

from .config import AuthSettings
from .security import LoginThrottle, check_credentials, issue_token, verify_token


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    username: str


class Me(BaseModel):
    username: str


def create_app(settings: AuthSettings | None = None) -> FastAPI:
    settings = settings or AuthSettings()
    throttle = LoginThrottle(settings.max_failed_logins, settings.lockout_minutes * 60)
    app = FastAPI(title="Auth service", version="0.1.0")

    def client_key(request: Request) -> str:
        # The gateway sets X-Forwarded-For; the direct peer is always the gateway.
        forwarded = request.headers.get("x-forwarded-for", "")
        return forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")

    def current_user(request: Request) -> str | None:
        auth = request.headers.get("authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else request.cookies.get(settings.cookie_name)
        return verify_token(settings, token) if token else None

    @app.get("/health", tags=["ops"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/login", response_model=TokenResponse)
    def login(body: LoginRequest, request: Request, response: Response):
        key = client_key(request)
        if throttle.is_locked(key):
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many failed attempts; try again later")
        if not check_credentials(settings, body.username, body.password):
            throttle.record_failure(key)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
        throttle.reset(key)
        token, ttl = issue_token(settings, body.username)
        response.set_cookie(
            settings.cookie_name,
            token,
            max_age=ttl,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
            path="/",
        )
        return TokenResponse(access_token=token, expires_in=ttl, username=body.username)

    @app.post("/logout", status_code=204)
    def logout(response: Response) -> None:
        response.delete_cookie(settings.cookie_name, path="/", secure=settings.cookie_secure, httponly=True, samesite="lax")

    @app.get("/me", response_model=Me)
    def me(request: Request):
        user = current_user(request)
        if user is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
        return Me(username=user)

    @app.get("/verify", include_in_schema=False)
    def verify(request: Request) -> Response:
        user = current_user(request)
        if user is None:
            return Response(status_code=status.HTTP_401_UNAUTHORIZED)
        return Response(status_code=status.HTTP_200_OK, headers={"X-Auth-User": user})

    return app
