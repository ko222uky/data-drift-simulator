#!/usr/bin/env bash
# Back up everything worth keeping: both Postgres databases (MLflow runs/registry and
# the model service's state) and the MLflow artifact volume (logged models).
#
#   bash /opt/mlops-demo/deploy/droplet/backup.sh [output-dir]
#
# Schedule it with cron, e.g. daily at 03:00, keeping the directory synced off-box
# (DigitalOcean Spaces, rsync, ...):
#   0 3 * * * bash /opt/mlops-demo/deploy/droplet/backup.sh /var/backups/mlops-demo
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${1:-$APP_DIR/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"
cd "$APP_DIR"

set -a; . ./.env; set +a
PGUSER="${POSTGRES_USER:-mlops}"

for db in mlflow model; do
    echo "==> Dumping database ${db}"
    docker compose exec -T postgres pg_dump -U "$PGUSER" -Fc "$db" > "$OUT_DIR/${db}-${STAMP}.dump"
done

echo "==> Archiving MLflow artifacts"
docker compose run --rm --no-deps -T --entrypoint tar mlflow -C /mlartifacts -czf - . > "$OUT_DIR/mlartifacts-${STAMP}.tar.gz"

# Keep the 14 most recent backups of each kind.
for prefix in mlflow model mlartifacts; do
    ls -1t "$OUT_DIR"/"$prefix"-* 2>/dev/null | tail -n +15 | xargs -r rm --
done

echo "Backups written to $OUT_DIR"
