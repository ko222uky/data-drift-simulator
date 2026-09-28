# MLflow service

**Stack:** MLflow 3.16 tracking server · Postgres backend store · local artifact volume

This service is the system of record for experiments and models. The model service writes
to it; operators browse it at `/mlflow/` after signing in.

## What gets recorded

| MLflow object | Produced when | Contents |
|---|---|---|
| Experiment `drift-monitoring` | first start | all runs below |
| Run `monitoring-<session>` | each model-service session | params of the problem + policy; per-interval metrics `live_accuracy`, `live_loss`, `model_version`, `drift_progress`; tags for every policy change |
| Run `train-v<N>` | each (re)training | params (reason, window, rows); per-epoch `train_/val_ loss & accuracy`; `final_val_accuracy`; the PyTorch model |
| Registered model `drift-classifier` | each training | version N per training; alias **`champion`** → deployed version |

## How it runs

- `entrypoint.sh` starts `mlflow server` with:
  - `--static-prefix /mlflow`, so the UI, REST API and artifact proxy all live under one path
    the gateway can route.
  - `--serve-artifacts --artifacts-destination /mlartifacts`: clients upload models through the
    server (as `mlflow-artifacts:/` URIs) and never touch the disk directly. `/mlartifacts` is
    the `mlflow_artifacts` volume.
  - `--allowed-hosts` / `--cors-allowed-origins` from `MLFLOW_ALLOWED_HOSTS` /
    `MLFLOW_CORS_ORIGINS`. MLflow 3 rejects unknown `Host` headers (DNS-rebinding protection)
    and cross-origin writes. Compose sets these from `PUBLIC_HOST` / `PUBLIC_ORIGIN`.
- Access control is handled by the gateway, not by MLflow's own auth plugin.

## Configuration

| Variable | Meaning |
|---|---|
| `MLFLOW_BACKEND_STORE_URI` | `postgresql+psycopg://user:pass@postgres:5432/mlflow` |
| `MLFLOW_ALLOWED_HOSTS` | Comma-separated `Host` patterns (fnmatch) |
| `MLFLOW_CORS_ORIGINS` | Comma-separated origins allowed to make state-changing requests |
| `MLFLOW_WORKERS` | Server workers (default 2) |

To move artifacts to DigitalOcean Spaces (S3-compatible), point `--artifacts-destination` at
`s3://bucket/path`. Then set `MLFLOW_S3_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`, and add `boto3` to the image.
