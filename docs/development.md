# Local development

## Everything in Docker (closest to production)

```bash
cp .env.example .env          # defaults work for http://localhost; change the passwords anyway
docker compose up --build
```

Open http://localhost (set `HTTP_PORT=8080` in `.env` if port 80 is taken) and sign in with
`ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`.

## Working on one service

Each service is an independent project with its own dependencies and tests.

| Service | Setup | Tests | Run |
|---|---|---|---|
| model | `cd services/model && uv sync` | `uv run pytest` | `uv run uvicorn --factory model_service.api:create_app --reload --port 8002` |
| auth | `cd services/auth && uv sync` | `uv run pytest` | `AUTH_ADMIN_PASSWORD=dev AUTH_JWT_SECRET=<32+ chars> AUTH_COOKIE_SECURE=false uv run uvicorn --factory auth_service.api:create_app --reload --port 8001` |
| frontend | `cd frontend && npm install` | `npm run lint && npm run build` | `API_PROXY_TARGET=http://localhost:8080 npm run dev` |

Without `MODEL_MLFLOW_TRACKING_URI`, the model service skips MLflow logging and uses a local
SQLite file, so it runs standalone.

A typical loop for frontend work: keep the backend running in compose (`docker compose up
gateway`, which pulls in its dependencies) and run `npm run dev` with `API_PROXY_TARGET`
pointing at the gateway.

### Running the gateway without Docker

The Caddyfile reads its upstreams from environment variables, so a local Caddy binary can
sit in front of services running directly on the host:

```bash
SITE_ADDRESS=http://localhost:8088 \
AUTH_UPSTREAM=127.0.0.1:8001 MODEL_UPSTREAM=127.0.0.1:8002 \
MLFLOW_UPSTREAM=127.0.0.1:5000 FRONTEND_UPSTREAM=127.0.0.1:3000 \
caddy run --config services/gateway/Caddyfile --adapter caddyfile
```

For MLflow, run `mlflow server --static-prefix /mlflow --port 5000` and set
`MODEL_MLFLOW_TRACKING_URI=http://127.0.0.1:5000/mlflow`.

## Conventions

- Python services use `uv`, a `src/` layout, pydantic-settings with a per-service env prefix
  (`MODEL_`, `AUTH_`), and an app factory (`create_app`) run with `uvicorn --factory`.
- A frontend type change that mirrors an API change goes in `frontend/src/lib/types.ts`.
- CI (`.github/workflows/ci.yml`) runs every service's tests, the frontend lint and build,
  and validates the compose and Caddy configs.
