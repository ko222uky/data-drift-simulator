#!/bin/sh
# Starts the MLflow tracking server (UI + REST API + artifact proxy).
#
# Required:
#   MLFLOW_BACKEND_STORE_URI   e.g. postgresql+psycopg://user:pass@postgres:5432/mlflow
# Optional:
#   MLFLOW_ALLOWED_HOSTS       Host headers accepted (DNS-rebinding protection)
#   MLFLOW_CORS_ORIGINS        Origins allowed to make state-changing browser requests
#   MLFLOW_WORKERS             Server worker processes (default 2)
set -eu

: "${MLFLOW_BACKEND_STORE_URI:?MLFLOW_BACKEND_STORE_URI must be set}"

set -- \
    --host 0.0.0.0 \
    --port 5000 \
    --workers "${MLFLOW_WORKERS:-2}" \
    --backend-store-uri "$MLFLOW_BACKEND_STORE_URI" \
    --serve-artifacts \
    --artifacts-destination /mlartifacts \
    --static-prefix /mlflow

if [ -n "${MLFLOW_ALLOWED_HOSTS:-}" ]; then
    set -- "$@" --allowed-hosts "$MLFLOW_ALLOWED_HOSTS"
fi
if [ -n "${MLFLOW_CORS_ORIGINS:-}" ]; then
    set -- "$@" --cors-allowed-origins "$MLFLOW_CORS_ORIGINS"
fi

exec mlflow server "$@"
