# Model service

**Stack:** Python 3.13 · PyTorch (CPU) · FastAPI · SQLAlchemy · MLflow client

The model service owns the whole ML lifecycle of the demo. It simulates the data-generating
process, serves the classifier, monitors live accuracy, retrains when the policy says so,
and reports everything to MLflow.

## Responsibilities

| Concern | Module | Notes |
|---|---|---|
| Data simulation | `simulator.py` | K latent classes with centres P in R^M; Gaussian noise; linear drift to new centres P2 at rate r |
| Classifier | `network.py` | 2-hidden-layer MLP; input standardisation baked into the module as buffers |
| Control loop | `monitor.py` | One interval per tick: generate → predict → record → maybe retrain |
| Persistence | `storage.py` | Rolling observation window, per-interval metrics, event log (Postgres or SQLite) |
| Visualisation | `projection.py` | PCA fitted once per session and frozen, so drift is visible in 2-D |
| Tracking | `tracking.py` | Monitoring run + one run per training; models registered with a `champion` alias |
| HTTP API | `api.py`, `schemas.py` | FastAPI; OpenAPI docs at `/docs` |
| Config | `config.py` | `MODEL_*` env vars; runtime policy editable via `PUT /config` |

## The control loop

Each interval `t → t+1`:

1. Generate `n` observations around the current centres (moving toward `P2` if drifting).
2. Predict with the deployed model; store the observations, accuracy and loss; log them to MLflow.
3. Drop observations older than `2w` intervals. That keeps the window `W` plus `w` older intervals for the plot.
4. If accuracy < threshold for `i` consecutive intervals, and no retry cool-down is active:
   retrain on `W` (the last `w` intervals), register the new model in MLflow, and hot-swap it.
5. If the new model's validation accuracy is still below the threshold, no retrain may start
   for another `I` intervals.

The loop runs in one background thread. HTTP handlers read state under a lock. Slow requests
(manual retrain, reset) are queued to the loop thread, so a request never waits on training.
Training and MLflow uploads happen outside the lock, so the API stays responsive while the
model trains.

## API

GET routes are public; everything else is protected by the gateway (see `services/gateway`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/status` | Phase, interval, deployed model, drift, policy |
| GET | `/metrics?limit=` | Accuracy/loss per interval |
| GET | `/events?limit=` | Event log (newest first) |
| GET | `/projection?max_points=` | 2-D projected points (W + older), current centres, drift targets |
| GET / PUT | `/config` | Read / partially update the monitoring policy |
| POST | `/drift` | Start drifting to new random centres |
| POST | `/retrain` | Queue a manual retrain on W |
| POST | `/pause`, `/resume` | Pause / resume the interval loop |
| POST | `/reset` | Start a new session (new data, new v1 model) |

## Configuration

Fixed at start-up (restart to change):

| Variable | Default | Meaning |
|---|---|---|
| `MODEL_N_FEATURES` | 8 | M: dimensions |
| `MODEL_N_CLASSES` | 4 | K: latent classes |
| `MODEL_INITIAL_SIZE` | 2000 | N: initial observations |
| `MODEL_NOISE_STD` | 1.5 | Spread around each centre (higher = harder problem) |
| `MODEL_CENTER_SPREAD` | 4.0 | Centres drawn from [-spread, spread]^M |
| `MODEL_SEED` | 7 | RNG seed |
| `MODEL_EPOCHS`, `MODEL_LEARNING_RATE`, `MODEL_HIDDEN_UNITS` | 30, 0.01, 64 | Training |
| `MODEL_DATABASE_URL` | `sqlite:///./model_service.db` | SQLAlchemy URL |
| `MODEL_MLFLOW_TRACKING_URI` | *(empty = disabled)* | e.g. `http://mlflow:5000/mlflow` |
| `MODEL_MLFLOW_EXPERIMENT` | `drift-monitoring` | |
| `MODEL_REGISTERED_MODEL_NAME` | `drift-classifier` | |

Initial runtime policy, which you can change live from the dashboard: `MODEL_BATCH_SIZE` (n=100),
`MODEL_INTERVAL_SECONDS` (5), `MODEL_ACCURACY_THRESHOLD` (0.85), `MODEL_BREACH_INTERVALS`
(i=3), `MODEL_WINDOW_INTERVALS` (w=10), `MODEL_RETRY_INTERVALS` (I=5), `MODEL_DRIFT_RATE` (r=0.05).

## Design notes

- **Each process start is a new session.** The simulation state lives in memory, so start-up
  clears the service's tables. Its MLflow history survives, tagged by `session`.
- **Run exactly one worker.** The loop is in-process state; more uvicorn workers would mean
  more competing simulations.
- **MLflow is an observer.** If the tracking server is down, errors are logged and the loop
  keeps running.
- **Models are logged in MLflow's traced `pt2` format** with an explicit tensor signature. Load
  one anywhere with `mlflow.pytorch.load_model("models:/drift-classifier@champion")`.

## Develop

```bash
uv sync
uv run pytest
MODEL_INTERVAL_SECONDS=2 uv run uvicorn --factory model_service.api:create_app --reload --port 8002
# http://localhost:8002/docs
```
