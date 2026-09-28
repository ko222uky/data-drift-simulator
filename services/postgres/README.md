# Database

**Stack:** stock `postgres:17-alpine` image

A single Postgres instance holds two databases:

| Database | Owner service | Contents |
|---|---|---|
| `model` | model service | `observations` (rolling window), `interval_metrics`, `events`. The model service recreates these tables at start-up |
| `mlflow` | MLflow | Experiments, runs, metrics, params, model registry. MLflow runs its own schema migrations |

`init/01-create-databases.sh` runs only when the `pgdata` volume is **first created**. It adds
the `mlflow` database next to `model`, which comes from `POSTGRES_DB`.

The database has no published port. To inspect it:

```bash
docker compose exec postgres psql -U mlops -d model
```

For backups, see `deploy/droplet/backup.sh`.
