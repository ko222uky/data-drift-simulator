#!/usr/bin/env bash
# One-time setup of this app on a droplet that's already provisioned by kloworld-edge
# (github.com/ko222uky/kloworld-edge: Docker, swap, firewall, the shared `edge` network and
# the HTTPS proxy). Run as root:
#
#   bash provision.sh <git-repo-url>                  # clone to /opt/mlops-demo, create .env
#   bash /opt/mlops-demo/deploy/droplet/provision.sh  # after cloning yourself: create .env
#
# Idempotent: an existing clone is fast-forwarded and an existing .env is never touched.
set -euo pipefail

REPO_URL="${1:-}"
APP_DIR="${APP_DIR:-/opt/mlops-demo}"

if [[ $EUID -ne 0 ]]; then
    echo "Run as root (sudo)." >&2
    exit 1
fi

if ! command -v docker >/dev/null || ! docker network inspect edge >/dev/null 2>&1; then
    echo "Docker or the shared 'edge' network is missing: provision the host with" >&2
    echo "kloworld-edge's scripts/provision.sh first." >&2
    exit 1
fi

if [[ -n "$REPO_URL" ]]; then
    echo "==> Fetching application into ${APP_DIR}"
    if [[ -d "$APP_DIR/.git" ]]; then
        git -C "$APP_DIR" pull --ff-only
    else
        git clone "$REPO_URL" "$APP_DIR"
    fi
fi

if [[ -d "$APP_DIR" && ! -f "$APP_DIR/.env" ]]; then
    echo "==> Creating ${APP_DIR}/.env with generated secrets"
    secret() { openssl rand -base64 36 | tr -d '/+=' | cut -c1-40; }
    # Secrets, plus the droplet settings: loopback port 8001 and the edge network overlay.
    sed -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$(secret)|" \
        -e "s|^JWT_SECRET=.*|JWT_SECRET=$(secret)|" \
        -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(secret)|" \
        -e "s|^HTTP_PORT=.*|HTTP_PORT=8001|" \
        -e "s|^# COMPOSE_FILE=|COMPOSE_FILE=|" \
        "$APP_DIR/.env.example" > "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"
fi

cat <<EOF

Provisioning complete.

Next steps:
  1. Edit ${APP_DIR}/.env -- set PUBLIC_HOST / PUBLIC_ORIGIN to your hostname and
     COOKIE_SECURE=true (see the comments in the file).
     The generated operator password is the ADMIN_PASSWORD line in that file.
  2. Deploy:  bash ${APP_DIR}/deploy/droplet/deploy.sh
  3. Add a site file for the hostname to kloworld-edge (caddy/sites/) and deploy that.
EOF
