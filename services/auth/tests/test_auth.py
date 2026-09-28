import time

import jwt
import pytest
from fastapi.testclient import TestClient

from auth_service.api import create_app
from auth_service.config import AuthSettings
from auth_service.security import ALGORITHM, ISSUER

SECRET = "x" * 40


@pytest.fixture
def settings() -> AuthSettings:
    return AuthSettings(admin_username="admin", admin_password="hunter2", jwt_secret=SECRET, cookie_secure=False)


@pytest.fixture
def client(settings) -> TestClient:
    return TestClient(create_app(settings))


def test_login_sets_cookie_and_verify_accepts_it(client):
    r = client.post("/login", json={"username": "admin", "password": "hunter2"})
    assert r.status_code == 200
    assert "session" in r.cookies
    v = client.get("/verify")
    assert v.status_code == 200
    assert v.headers["x-auth-user"] == "admin"
    assert client.get("/me").json() == {"username": "admin"}


def test_bearer_token_is_accepted(client):
    token = client.post("/login", json={"username": "admin", "password": "hunter2"}).json()["access_token"]
    client.cookies.clear()
    assert client.get("/verify", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_rejects_bad_credentials_and_missing_or_forged_tokens(client):
    assert client.post("/login", json={"username": "admin", "password": "nope"}).status_code == 401
    assert client.get("/verify").status_code == 401
    forged = jwt.encode({"sub": "admin", "iss": ISSUER, "exp": time.time() + 60}, "y" * 40, algorithm=ALGORITHM)
    assert client.get("/verify", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    expired = jwt.encode({"sub": "admin", "iss": ISSUER, "exp": time.time() - 1}, SECRET, algorithm=ALGORITHM)
    assert client.get("/verify", headers={"Authorization": f"Bearer {expired}"}).status_code == 401


def test_logout_clears_cookie(client):
    client.post("/login", json={"username": "admin", "password": "hunter2"})
    client.post("/logout")
    assert client.get("/verify").status_code == 401


def test_lockout_after_repeated_failures(client, settings):
    for _ in range(settings.max_failed_logins):
        client.post("/login", json={"username": "admin", "password": "wrong"})
    r = client.post("/login", json={"username": "admin", "password": "hunter2"})
    assert r.status_code == 429


def test_short_secret_is_rejected():
    with pytest.raises(ValueError):
        AuthSettings(admin_password="p", jwt_secret="short")
