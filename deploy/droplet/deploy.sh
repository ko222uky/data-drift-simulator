#!/usr/bin/env bash
# Build and (re)start the stack on the droplet. Run from anywhere:
#
#   bash /opt/mlops-demo/deploy/droplet/deploy.sh            # pull latest, rebuild, restart
#   SKIP_PULL=1 bash /opt/mlops-demo/deploy/droplet/deploy.sh # deploy the checked-out tree as-is
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$APP_DIR"

if [[ ! -f .env ]]; then
    echo "Missing $APP_DIR/.env -- copy .env.example and fill it in (or run provision.sh)." >&2
    exit 1
fi

if grep -qE '^(ADMIN_PASSWORD|JWT_SECRET|POSTGRES_PASSWORD)=change-me' .env; then
    echo "Refusing to deploy: .env still contains placeholder secrets." >&2
    exit 1
fi

if [[ -z "${SKIP_PULL:-}" && -d .git ]]; then
    echo "==> Pulling latest code"
    git pull --ff-only
fi

echo "==> Building images"
docker compose build --pull

echo "==> Starting services"
docker compose up -d --remove-orphans

echo "==> Removing dangling images"
docker image prune -f >/dev/null

echo "==> Waiting for the gateway"
set -a; . ./.env; set +a
url="${PUBLIC_ORIGIN:-http://localhost}/api/model/health"
for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
        docker compose ps
        echo
        echo "Deployed: ${PUBLIC_ORIGIN:-http://localhost}"
        exit 0
    fi
    sleep 5
done

echo "Gateway did not become healthy at $url. Inspect with: docker compose logs --tail=100" >&2
docker compose ps
exit 1
