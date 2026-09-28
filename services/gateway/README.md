# API gateway

**Stack:** [Caddy 2](https://caddyserver.com/). The whole service is its configuration, in [`Caddyfile`](./Caddyfile).

The gateway is the only container that publishes ports. It terminates TLS, routes by path,
and enforces authentication by calling the auth service before it forwards protected
requests.

## Routes

| Path | Upstream | Access |
|---|---|---|
| `/api/auth/*` | auth service (prefix stripped) | public; `/api/auth/verify` returns 404 |
| `/api/model/*` `GET`/`HEAD` | model service (prefix stripped) | public |
| `/api/model/*` other methods | model service | **session required** → 401 otherwise |
| `/mlflow/*` | MLflow (served under the `/mlflow` prefix) | **session required** → redirect to `/login?next=/mlflow/` |
| everything else | Next.js frontend | public |

Enforcement uses Caddy's [`forward_auth`](https://caddyserver.com/docs/caddyfile/directives/forward_auth).
Before proxying a protected request, the gateway sends its headers and cookies to
`auth:8000/verify`. A `2xx` answer lets the request through, with `X-Auth-User` copied onto
it. Anything else is returned to the client.

## TLS

`SITE_ADDRESS` controls TLS:

- `http://localhost`: plain HTTP for local work.
- `demo.example.com`: Caddy obtains and renews a Let's Encrypt certificate automatically.
  DNS must already point at the droplet, and ports 80/443 must be open. Certificates are
  stored in the `caddy_data` volume; keep that volume, or you'll hit Let's Encrypt's
  rate limits when redeploying.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SITE_ADDRESS` | `:80` | Site address; see TLS above |
| `AUTH_UPSTREAM`, `MODEL_UPSTREAM`, `MLFLOW_UPSTREAM`, `FRONTEND_UPSTREAM` | compose service names | Override to run the gateway against services on the host |

Validate after editing:

```bash
docker run --rm -e SITE_ADDRESS=http://localhost -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.11-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```
