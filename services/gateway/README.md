# API gateway

**Stack:** [Caddy 2](https://caddyserver.com/). The whole service is its configuration, in [`Caddyfile`](./Caddyfile).

The gateway is the app's single entry point and the only container that publishes a port
(on `127.0.0.1`). It routes by path and enforces authentication by calling the auth service
before it forwards protected requests.

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

## TLS and the edge proxy

The gateway serves plain HTTP on `:80` for any hostname. On the droplet, HTTPS is terminated
in front of it by the shared edge proxy,
[`kloworld-edge`](https://github.com/ko222uky/kloworld-edge). That proxy holds the Let's
Encrypt certificate and forwards `datadrift.kloworld.com` to `datadrift-gateway:80` on the
`edge` Docker network, which [`compose.edge.yml`](../../compose.edge.yml) attaches the gateway to.

The global `trusted_proxies static private_ranges` keeps the `X-Forwarded-For` and
`X-Forwarded-Proto` headers that the edge proxy sets. The auth service throttles logins by the
first `X-Forwarded-For` address, so without this every visitor would share the proxy's IP.
The edge proxy trusts nobody and overwrites these headers, so clients can't spoof them.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SITE_ADDRESS` | `:80` | Listen address. Compose leaves the default; set it only for a host-run Caddy (see [development.md](../../docs/development.md)) |
| `AUTH_UPSTREAM`, `MODEL_UPSTREAM`, `MLFLOW_UPSTREAM`, `FRONTEND_UPSTREAM` | compose service names | Override to run the gateway against services on the host |

Validate after editing:

```bash
docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.11-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```
