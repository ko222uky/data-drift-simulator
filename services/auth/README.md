# Auth service

**Stack:** Python 3.13 · FastAPI · PyJWT

This service issues and verifies operator sessions. It has one job, and the gateway uses it
as a **forward-auth** hook, so no other service needs its own authentication code.

## Model

- **One operator account**, configured through environment variables. The dashboard is public
  to read; signing in is only needed to control the simulation and to open MLflow.
- A successful login returns a **HS256 JWT**. The token comes back both in the response body
  (for API clients) and as an `HttpOnly`, `SameSite=Lax` cookie (for the browser; page scripts
  never see the token).
- The gateway calls `GET /verify` before every protected request. It accepts either
  `Authorization: Bearer <jwt>` or the cookie, returns `200` with an `X-Auth-User` header or
  `401`. The gateway returns 404 for `/verify` to the outside world.
- **Brute-force protection:** after 5 failed logins from one client IP within 15 minutes,
  further attempts return `429`. The count lives in memory, so run a single worker. The
  client IP is the first `X-Forwarded-For` address. That's the real visitor only because the
  gateway trusts the edge proxy's headers (`trusted_proxies` in the Caddyfile).

## API (exposed as `/api/auth/*` by the gateway)

| Method | Path | Purpose |
|---|---|---|
| POST | `/login` | `{username, password}` → token + session cookie |
| POST | `/logout` | Clear the cookie |
| GET | `/me` | Current user, or 401 |
| GET | `/verify` | Forward-auth hook (internal only) |
| GET | `/health` | Liveness |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AUTH_ADMIN_USERNAME` | `admin` | Operator username |
| `AUTH_ADMIN_PASSWORD` | *(required)* | Operator password |
| `AUTH_JWT_SECRET` | *(required, ≥ 32 chars)* | HMAC signing key; rotating it signs everyone out |
| `AUTH_TOKEN_TTL_MINUTES` | 720 | Session length |
| `AUTH_COOKIE_SECURE` | `true` | Set `false` only for plain-HTTP local development |
| `AUTH_MAX_FAILED_LOGINS` / `AUTH_LOCKOUT_MINUTES` | 5 / 15 | Throttle |

## Extending

To support more users, replace `check_credentials` in `security.py` with a lookup against
a user table that stores password hashes (for example argon2 via `pwdlib`). Nothing
outside this service has to change. Everything else only depends on `/verify`.

## Develop

```bash
uv sync
uv run pytest
AUTH_ADMIN_PASSWORD=dev AUTH_JWT_SECRET=$(openssl rand -hex 32) AUTH_COOKIE_SECURE=false \
  uv run uvicorn --factory auth_service.api:create_app --reload --port 8001
```
