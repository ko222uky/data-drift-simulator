# Developer onboarding

Welcome! This guide takes you from "never seen this repo" to "can maintain it and ship
features". It assumes you're comfortable with **Python** but may be new to **Docker**,
**Caddy** (the web server/gateway) and the **TypeScript/React/Next.js** frontend. Each of those
gets a short primer where you first meet it.

- Part 1 is a **reading order**: what to read, in which sequence, and why.
- Part 2 has **detailed notes** on each part of the source code.
- Part 3 covers **recipes, operations and known limitations**.
- Part 4 collects **external documentation** links.

This guide is maintained alongside the code: a change that makes any part of it wrong updates
it in the same pull request (see [§17](#17-keeping-this-guide-current)).

---

## Contents

1. [What you're taking over](#1-what-youre-taking-over)
2. [Set up your machine](#2-set-up-your-machine)
3. [Reading order](#3-reading-order)
4. [Primer: Docker and Docker Compose](#4-primer-docker-and-docker-compose)
5. [The gateway (Caddy)](#5-the-gateway-caddy)
6. [The model service (Python, the heart of the system)](#6-the-model-service)
7. [The auth service](#7-the-auth-service)
8. [MLflow and Postgres](#8-mlflow-and-postgres)
9. [Primer: TypeScript, React and Next.js](#9-primer-typescript-react-and-nextjs)
10. [The frontend source](#10-the-frontend-source)
11. [Tests, CI and continuous deployment](#11-tests-ci-and-continuous-deployment)
12. [Recipes: how to make common changes](#12-recipes-how-to-make-common-changes)
13. [Operating production](#13-operating-production)
14. [Gotchas we've already hit](#14-gotchas-weve-already-hit)
15. [Known limitations and ideas](#15-known-limitations-and-ideas)
16. [External resources](#16-external-resources)
17. [Keeping this guide current](#17-keeping-this-guide-current)

---

## 1. What you're taking over

A live **MLOps demo**. A simulator produces batches of data around hidden class centres. A
PyTorch classifier predicts each batch, and the system tracks its accuracy over time. When the
data *drifts* and accuracy stays below a threshold, the model **retrains itself** on recent data
and redeploys. Every training run is logged to **MLflow**, and a **Next.js dashboard** shows it
all live.

It's deployed at **https://datadrift.kloworld.com** on a DigitalOcean droplet, and every merge
to `main` deploys automatically.

```
Browser ──HTTPS──► gateway (Caddy) ──► frontend (Next.js)      pages
                                  ├──► auth (FastAPI)          login + session checks
                                  ├──► model (FastAPI+PyTorch) simulation, training, API
                                  └──► mlflow                  experiment tracking UI/API
                      model ──► mlflow ──► postgres + artifact volume
                      model ──► postgres
```

The full diagram is in the [README](../README.md#architecture) and the request flows are in
[architecture.md](architecture.md).

**Access you'll need:** the GitHub repo, SSH access to the droplet (add your public key to
`/root/.ssh/authorized_keys`), the DigitalOcean account, and the account at the DNS provider that
hosts `kloworld.com`. The operator password for the dashboard is `ADMIN_PASSWORD` in
`/opt/mlops-demo/.env` on the droplet.

---

## 2. Set up your machine

| Tool | Why | Install |
|---|---|---|
| Git | source control | https://git-scm.com/downloads |
| Docker Desktop (or Docker Engine) | runs the whole stack locally | https://docs.docker.com/get-started/get-docker/ |
| uv | Python package/project manager used by both Python services | https://docs.astral.sh/uv/getting-started/installation/ |
| Node.js 24 + npm | builds and runs the frontend | https://nodejs.org/en/download |
| GitHub CLI (`gh`) | secrets, CI runs, PRs from the terminal | https://cli.github.com/ |
| An editor with TypeScript support | e.g. VS Code | https://code.visualstudio.com/ |

First run (about 10 minutes, mostly downloading PyTorch):

```bash
git clone git@github.com:ko222uky/data-drift-simulator.git
cd data-drift-simulator
cp .env.example .env                 # local defaults; change the passwords anyway
docker compose up --build            # builds 4 images, starts 6 containers
# open http://localhost and sign in with ADMIN_USERNAME / ADMIN_PASSWORD from .env
```

Then run the tests once, so you know your toolchain works:

```bash
(cd services/model && uv sync && uv run pytest)     # ~30 tests
(cd services/auth  && uv sync && uv run pytest)     # ~6 tests
(cd frontend && npm install && npm run lint && npm run build)
```

On Windows, use Git Bash or WSL for the shell commands in these docs. See
[§14](#14-gotchas-weve-already-hit) for two Windows-specific traps.

---

## 3. Reading order

Read in this order. Each step builds on the previous one. Times are rough, for a careful first read.

### Day 1: the big picture and running it (~3 h)

| # | Read | Why |
|---|---|---|
| 1 | [README.md](../README.md) | What the demo does, the workflow diagram, the architecture diagram |
| 2 | [docs/architecture.md](architecture.md) | Service table, access policy, the monitoring loop as a sequence diagram, symbol glossary (N, n, r, i, w, I) |
| 3 | [§4 Docker primer](#4-primer-docker-and-docker-compose), then [`docker-compose.yml`](../docker-compose.yml) and [`.env.example`](../.env.example) | How the six containers are wired, configured and started |
| 4 | [§5](#5-the-gateway-caddy), then [`services/gateway/Caddyfile`](../services/gateway/Caddyfile) | Every URL the outside world can reach, and who needs a login |
| 5 | Run the stack, click around, trigger drift, open `/mlflow/` | Seeing it working makes the code much easier to read |

### Days 2–3: the model service, the core of the system (~6 h)

Read [`services/model/README.md`](../services/model/README.md) first, then the modules in this order:

| # | File | What to take away |
|---|---|---|
| 6 | [`config.py`](../services/model/src/model_service/config.py) | Startup settings (`MODEL_*` env vars) vs runtime-editable `MonitorConfig` and `TrainingConfig` |
| 7 | [`simulator.py`](../services/model/src/model_service/simulator.py) | How data and drift are generated (class centres, linear drift legs) |
| 8 | [`projection.py`](../services/model/src/model_service/projection.py) | The frozen 2-D PCA used by the scatter plot, and `lift()` for dragging centres |
| 9 | [`network.py`](../services/model/src/model_service/network.py) | The PyTorch MLP, the train/validation split, AdamW and early stopping |
| 10 | [`storage.py`](../services/model/src/model_service/storage.py) | SQLAlchemy tables: observations, per-interval metrics, events, training runs |
| 11 | [`tracking.py`](../services/model/src/model_service/tracking.py) | MLflow logging and model registration, built so MLflow can never crash the loop |
| 12 | [`monitor.py`](../services/model/src/model_service/monitor.py) | **The control loop.** Threading, the interval step, the retrain policy, operator actions. Read slowly |
| 13 | [`schemas.py`](../services/model/src/model_service/schemas.py) → [`api.py`](../services/model/src/model_service/api.py) | The HTTP API: response shapes, then the routes |
| 14 | [`tests/`](../services/model/tests) (`conftest.py` first) | Executable examples of every behaviour above |

### Day 4: auth, MLflow, Postgres (~2 h)

| # | File | What to take away |
|---|---|---|
| 15 | [`services/auth/`](../services/auth): README → `config.py` → `security.py` → `api.py` → tests | JWT sessions in an HttpOnly cookie, the `/verify` hook the gateway calls |
| 16 | [`services/mlflow/`](../services/mlflow): README → `Dockerfile` → `entrypoint.sh` | How the tracking server runs under `/mlflow` with host/origin protection |
| 17 | [`services/postgres/`](../services/postgres) | Two databases in one Postgres, created by an init script |

### Days 5–6: the frontend (~6 h, more if React is new to you)

Start with the [§9 primer](#9-primer-typescript-react-and-nextjs) and
[`frontend/README.md`](../frontend/README.md), then:

| # | File | What to take away |
|---|---|---|
| 18 | `package.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx` | Project setup, the dev proxy, the page shell |
| 19 | `src/lib/types.ts` → `api.ts` | TypeScript mirrors of the API and the one place HTTP calls live |
| 20 | `src/lib/usePolling.ts`, `auth.tsx`, `useOperatorAction.ts` | How data is fetched live, who's signed in, how buttons call the API |
| 21 | `src/components/Dashboard.tsx` | The page layout and all shared state (polling, selected model version) |
| 22 | `StatTiles`, `AccuracyChart`, `TrainingRunsChart`, `ModelLossChart` | The charts (Recharts) |
| 23 | `ProjectionChart` → `NearestPointHover` → `CenterDragLayer` → `classStyle` | The interactive scatter plot: hover and drag layers |
| 24 | `Controls`, `TrainingParams`, `ConfigForm`, `ui.tsx`, `Panel.tsx`, `EventLog`, `Header` | Forms, switches and building blocks |
| 25 | `src/app/globals.css` | Colour tokens (light/dark) used by everything |

### Day 7: delivery and operations (~2 h)

| # | Read | What to take away |
|---|---|---|
| 26 | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Tests on every PR; deploy on `main` |
| 27 | [`deploy/droplet/`](../deploy/droplet): `provision.sh`, `deploy.sh`, `ci-deploy.sh`, `backup.sh` | How the server was built and how deploys run |
| 28 | [docs/deployment.md](deployment.md), [docs/development.md](development.md) | Runbooks: setup, DNS, secrets, troubleshooting, local workflows |

After that, try [§12](#12-recipes-how-to-make-common-changes) on a branch: add a trivial
setting end to end. It touches every layer and is the fastest way to feel at home.

---

## 4. Primer: Docker and Docker Compose

If Docker is new, this is the one concept to absorb first. Everything else runs inside it.

- **Image:** a packaged filesystem plus a start command, built from a **Dockerfile**. It's
  like a frozen virtualenv that also contains the OS and the Python interpreter.
- **Container:** a running instance of an image. It's isolated, and disposable: throw it away
  and start a new one from the same image.
- **Docker Compose:** runs several containers together from one YAML file
  ([`docker-compose.yml`](../docker-compose.yml)). `docker compose up --build` builds the
  images and starts everything.
- **Network:** Compose puts all six containers on one private network (`mlops-demo_default`),
  where they reach each other **by service name**. That's why the model service talks to
  `http://mlflow:5000` and the Caddyfile routes to `auth:8000`.
- **Ports:** only the `gateway` publishes ports (80, 443) to the host. Nothing else is
  reachable from outside, Postgres included.
- **Volumes:** containers are disposable, so anything that must survive lives in **named
  volumes**: `pgdata`, `mlflow_artifacts`, `caddy_data` (TLS certificates), `caddy_config`.
  `docker compose down` keeps them; `docker compose down -v` **deletes them**, so be careful.
- **Health checks:** each image declares a `HEALTHCHECK`. Compose's
  `depends_on: condition: service_healthy` then starts services in order
  (postgres → mlflow → model → gateway).
- **Configuration:** `${VAR}` in the Compose file comes from `.env`. Never commit `.env`.

Our Dockerfiles follow one pattern worth recognising. For example, in
[`services/model/Dockerfile`](../services/model/Dockerfile): copy only `pyproject.toml` + `uv.lock`,
install dependencies (a cached layer, so PyTorch isn't re-downloaded on every code change),
copy `src/`, install the project, then switch to a non-root user. The frontend Dockerfile is
**multi-stage**: install, then build, then copy only the built output into a small runtime image.

Everyday commands:

```bash
docker compose ps                      # what's running, health status
docker compose logs -f model           # follow one service's logs
docker compose up -d --build model     # rebuild + restart one service after code changes
docker compose exec postgres psql -U mlops -d model   # a SQL shell
docker compose down                    # stop everything (volumes are kept)
```

---

## 5. The gateway (Caddy)

[Caddy](https://caddyserver.com/docs/) is a web server. Here it is the **only door into the
system**. Read [`services/gateway/Caddyfile`](../services/gateway/Caddyfile) alongside this:

- **The site address** (`{$SITE_ADDRESS}`) decides TLS. `http://localhost` means plain HTTP;
  a hostname like `datadrift.kloworld.com` makes Caddy obtain and renew a Let's Encrypt
  certificate automatically ([automatic HTTPS](https://caddyserver.com/docs/automatic-https)).
- **`handle` / `handle_path` blocks** route by URL path. `handle_path` also strips the matched
  prefix, so `/api/model/status` arrives at the model service as `/status`.
- **[`forward_auth`](https://caddyserver.com/docs/caddyfile/directives/forward_auth)** is how
  login is enforced. Before a protected request (any non-GET to `/api/model/*`, and all of
  `/mlflow/*`), Caddy sends the request's cookies to `auth:8000/verify`. A 2xx reply lets the
  request through; anything else goes back to the client (401, or a redirect to `/login`
  for MLflow). **Backend services contain no auth code.** This one file is the security policy.
- **`/api/auth/verify` returns 404** to the public on purpose.
- **Upstreams** default to Compose service names but can be overridden (`MODEL_UPSTREAM`, …),
  so you can run Caddy against services on your laptop (see [development.md](development.md)).

To validate after editing, run `caddy validate` (the command is in
[`services/gateway/README.md`](../services/gateway/README.md)). CI runs it too.

---

## 6. The model service

**Stack:** FastAPI (HTTP), Pydantic (validation and settings), SQLAlchemy 2.0 (database),
PyTorch (model), MLflow client (tracking), uv (dependencies). The service README has the full
endpoint and environment-variable tables; these notes explain *how the code thinks*.

### 6.1 Configuration (`config.py`)
There are three kinds of settings:

- **`ServiceSettings`** is read once at startup from environment variables prefixed `MODEL_`
  (via [pydantic-settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/)).
- **`MonitorConfig`** (the monitoring policy: threshold, *i*, *w*, *I*, *r*, *n*, seconds per
  interval) is editable at runtime via `PUT /config`.
- **`TrainingConfig`** (epochs, patience, learning rate, weight decay, split method…) is
  editable at runtime via `PUT /training-config`.

`_partial()` generates the "all fields optional" update models, so a PUT can change a single
field. Field bounds live on the full models; the API maps violations to HTTP 422.

### 6.2 Simulation (`simulator.py`) and projection (`projection.py`)
- **Data generation:** each class *k* has a centre `P[k]` in M dimensions, and an
  observation is `P[k] + Gaussian noise`.
- **Drift** moves centres in a straight line towards targets `P2` at a fraction *r* of the
  path per interval.
- **Operator overrides:** `place_center` and `set_drift_target` support dragging centres.
- **The scatter plot** uses PCA fitted **once per session** and then frozen, so drift is
  visible as movement instead of the axes rotating.
- **`lift()`** maps a 2-D drop position back to M dimensions by moving only within the
  plotted plane.

### 6.3 Model and training (`network.py`)
`Classifier` is a two-hidden-layer MLP with input standardisation stored as buffers, so a
saved model is self-contained. `train()`:

1. **Split** (`split_data`): *temporal* validates on the newest intervals, which gives an
   honest estimate under drift; *random* samples rows.
2. **Train** with [AdamW](https://pytorch.org/docs/stable/generated/torch.optim.AdamW.html)
   (weight decay regularises the model).
3. **Stop early** when validation loss hasn't improved for `patience` epochs, and **restore
   the best epoch's weights**. The reported metrics are that epoch's.

If PyTorch is new, the [60-minute basics tutorial](https://pytorch.org/tutorials/beginner/basics/intro.html)
covers everything used here.

### 6.4 Storage (`storage.py`)
SQLAlchemy 2.0 declarative models. Tables:

- `observations`: a rolling window. Rows older than 2*w* intervals are pruned each interval.
- `interval_metrics`: per-interval accuracy and loss.
- `events`: the event log.
- `training_runs`: per-epoch history as JSON, plus split and config details.

**`Store.reset()` drops and recreates every table at startup**, because each process start is
a new session. There are no migrations; see [§15](#15-known-limitations-and-ideas).

### 6.5 MLflow (`tracking.py`)
Each session gets one long **monitoring run** (a metric per interval), and each training gets
a **`train-v<N>` run**. That run has params, per-epoch curves and the model, which is
registered as `drift-classifier` with the `champion` alias on the deployed version.
**Every MLflow call goes through `_safely`**, so a tracking outage logs an error and the
simulation carries on. Models use MLflow's traced `pt2` format, which requires an input example
and an explicit tensor signature.

### 6.6 The control loop (`monitor.py`), read slowly
`MonitorEngine` owns all state. Key ideas:

- **One background thread** (`_run`) runs intervals; it's the only thread that trains.
- **Scheduling:** the loop sleeps on `self._wake` (a `threading.Event`) until the next
  interval is due. The due time, *time of the last step + current `interval_seconds`*, is
  **recomputed on every wake-up**. Any operator action that should take effect at once
  (`request()`, `update_config`, `set_paused`) calls `self._wake.set()`. That's why a new
  interval length applies immediately in both directions: shorter doesn't wait out the old
  interval, longer extends the current wait. If you add an action that changes timing, wake
  the loop too.
- **HTTP handlers** read state under `self.lock` (an `RLock`). Slow requests (retrain, reset)
  are queued in `_pending` and executed by the loop thread, so requests never block on
  training.
- **Training happens outside the lock** (`_retrain`), so the API stays responsive; only the
  swap of the deployed model is locked.
- **`step()` is one interval:**
  1. Sample a batch, predict and record.
  2. Prune old rows.
  3. Advance drift, and chain the next leg if continuous drift is on.
  4. Update the breach counter.
  5. Retrain if the policy says so and automatic retraining isn't paused.
- **Operator actions** (`start_drift`, `set_continuous_drift`, `move_center`,
  `set_auto_retrain`, `update_config`, …) all write an **event**. The kinds are strings;
  the frontend maps them to labels in `EventLog.tsx`.

### 6.7 API (`schemas.py`, `api.py`)
Routes are thin: they validate, call the engine, and return a Pydantic model.
**Interactive docs:** FastAPI generates them at `/docs`. The gateway doesn't expose them, so
run the service standalone (see [development.md](development.md)) and open
`http://localhost:8002/docs`.

---

## 7. The auth service

It's small and deliberately boring:

- **`security.py`** checks credentials in constant time (`hmac.compare_digest`), issues and
  verifies **HS256 JWTs** with [PyJWT](https://pyjwt.readthedocs.io/), and runs an in-memory
  login throttle (5 failures in 15 minutes gives HTTP 429).
- **`api.py`:** `/login` returns the token *and* sets an **HttpOnly, SameSite=Lax** cookie,
  so browser JavaScript never sees the token. `/verify` is the gateway's forward-auth hook.

There's a single operator account from environment variables. The service README explains how
to move to real users. Background reading: [cookies on MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies),
[JWT introduction](https://jwt.io/introduction).

---

## 8. MLflow and Postgres

- **MLflow** ([docs](https://mlflow.org/docs/latest/)) runs from a pinned image
  (`services/mlflow/Dockerfile`), with an entrypoint that builds the `mlflow server` command:
  - `--static-prefix /mlflow`, so the UI and API live under one path the gateway can route.
  - `--serve-artifacts`: clients upload models through the server into the
    `mlflow_artifacts` volume.
  - `--allowed-hosts` / `--cors-allowed-origins` (MLflow 3's DNS-rebinding and CSRF
    protection). If you change the public hostname, update `PUBLIC_HOST` / `PUBLIC_ORIGIN`
    in `.env`.
- **Postgres 17** holds two databases: `model` (the model service) and `mlflow` (created by
  `services/postgres/init/01-create-databases.sh` **only when the volume is first created**).
  See the [PostgreSQL docs](https://www.postgresql.org/docs/17/).

A harmless `duplicate key … metric_pk` error appears in Postgres logs after each training.
It's MLflow re-linking run metrics to the logged model, and no data is lost.

---

## 9. Primer: TypeScript, React and Next.js

The frontend is **TypeScript** (JavaScript with types, think Python type hints that are
actually enforced), **React** (UI as functions), **Next.js 16** (the React framework and
server), **Tailwind CSS** (styling via class names) and **Recharts** (charts).

Mental model for a Python developer:

- **A component is a function that returns markup (JSX).** `function Panel({ title }) { return <section>…</section> }`.
  Props are its arguments.
- **State** (`useState`) is a variable that re-renders the component when it changes. React
  re-runs the function; you describe the UI for the *current* state rather than mutating the DOM.
- **Effects** (`useEffect`) run side effects after rendering, like starting a timer or adding
  event listeners, and return a cleanup function. Our `usePolling` hook is a small, readable
  example.
- **Hooks** (`use…` functions) can only be called at the top level of components or other hooks.
- **`"use client"`** at the top of a file means it runs in the browser. This dashboard is
  essentially all client components: it fetches live data from the API in the browser.
- **Next.js App Router:** files under `src/app/` are routes. `app/page.tsx` is `/`,
  `app/login/page.tsx` is `/login`, and `layout.tsx` wraps every page.
- **Tailwind:** `className="rounded-md border px-3"` *is* the styling. Our colours are custom
  tokens (`bg-surface`, `text-ink-2`, `text-critical`…) defined in `globals.css` with
  light/dark values.

Two things specific to this repo:

- **`frontend/AGENTS.md`:** Next.js 16 changed a lot, and it ships its own docs in
  `node_modules/next/dist/docs/`. Check those (or the current [Next.js docs](https://nextjs.org/docs))
  rather than older tutorials.
- **The React Compiler lint rules** (`npm run lint`) are strict, and they reflect real React
  rules. The three that come up:
  - **Don't write refs during render.**
  - **Don't call `setState` synchronously inside an effect.** Derive the value instead, or
    remount a component with a `key`; `ConfigForm` is keyed by the saved config for exactly
    this reason.
  - **Don't mutate props,** e.g. DOM elements passed in. Route DOM writes through small
    helper functions, as `CenterDragLayer` does.

  See [You might not need an Effect](https://react.dev/learn/you-might-not-need-an-effect).

---

## 10. The frontend source

- **`src/lib/types.ts`** mirrors the model service's Pydantic schemas **by hand**. When you
  change a response in `schemas.py`, change it here too.
- **`src/lib/api.ts`** is the only place that calls `fetch`. All URLs are same-origin
  (`/api/model/...`, `/api/auth/...`). The gateway routes them, so the frontend never knows
  service hostnames.
- **`usePolling`** fetches every N ms and pauses while the tab is hidden. It needs a
  **stable** fetcher function (defined at module level or with `useCallback`), or it restarts
  every render.
- **`auth.tsx`** only tracks *who* is signed in (via `/api/auth/me`). The session itself is
  the HttpOnly cookie. **`useOperatorAction`** wraps a button's API call with busy, success
  and error state, and drops you to signed-out on a 401.
- **`Dashboard.tsx`** owns cross-panel state: all polling, and the **selected model version**
  shared by the loss widget and the accuracy chart's highlight lane.
- **Charts:** built with [Recharts](https://recharts.github.io/en-US/api/).
  - Custom SVG shapes and reference areas carry annotations (drift spans, redeploy rules,
    the training/validation lane).
  - Series colours come from CSS tokens (`--accent`, `--train`, `--validation`,
    `--class-0..7`). Classes are encoded by **colour and marker shape** (`classStyle.tsx`) so
    they stay distinguishable for colour-blind readers.
- **The scatter plot's interaction layers** (`NearestPointHover`, `CenterDragLayer`) are
  rendered *inside* the Recharts chart so they can use its scale hooks (`useXAxisScale`,
  `useXAxisInverseScale`, `usePlotArea`). They listen for pointer events **on the wrapper
  `<div>`**, because Recharts draws the marks above custom layers. The tooltip is positioned
  by writing a CSS transform directly, so mouse movement doesn't re-render 1,500 points.
- **`ConfigForm`** renders number and choice fields from a field list; `Controls` and
  `TrainingParams` are just field lists plus buttons.

Dev loop: start the backend with Compose (set `HTTP_PORT=8080` in `.env` if 80 is busy), then
`cd frontend && API_PROXY_TARGET=http://localhost:8080 npm run dev` for hot reload.

---

## 11. Tests, CI and continuous deployment

| Area | Command | Notes |
|---|---|---|
| Model service | `cd services/model && uv run pytest` | `conftest.py` builds an engine on SQLite with MLflow disabled. Most tests call `engine.step()` directly, with no thread; the interval-timing tests in `test_monitor.py` start the real loop (`engine.start()`) and poll with a timeout |
| Auth service | `cd services/auth && uv run pytest` | |
| Frontend | `cd frontend && npm run lint && npm run build` | There are no frontend unit tests yet (see §15) |
| Workflow | `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint -no-color` | Lints `.github/workflows` |
| End to end | `docker compose up --build`, then use the UI | The real integration test |

**CI** ([`ci.yml`](../.github/workflows/ci.yml)) runs on every PR and every push to `main`: the
Python tests for both services, frontend lint + build, and Compose and Caddy validation.

**CD:** when all of those pass on `main`, the `deploy` job SSHes to the droplet with a
dedicated key. That key is locked by a **forced command** (`/usr/local/bin/mlops-ci-deploy`,
source in `deploy/droplet/ci-deploy.sh`) to "deploy this commit SHA if it's on `main`". Then
it smoke-tests the site. Deploys queue rather than overlap. The details and key rotation are in
[deployment.md → Automatic deploys](deployment.md#automatic-deploys-github-actions).

**Workflow conventions:**
- Branch per change, pull request into `main`, and merging deploys.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat(scope):`, `fix(ci):`, `docs(readme):`…), with a body that explains *why*.
- **Don't name a branch `docs/…`:** a branch called `docs` already exists, and Git can't have
  both.

---

## 12. Recipes: how to make common changes

### Add a runtime setting (touches every layer)
1. **`config.py`:** add a field with bounds and a description to `MonitorConfig` or
   `TrainingConfig`, plus an initial value on `ServiceSettings` (`MODEL_<NAME>`). The partial
   update model picks it up automatically.
2. **Use it** in `monitor.py` or `network.py` (read `self.config.<name>` under the lock).
3. **Tests:** a unit test in `tests/`, and a line in `test_api.py` that PUTs it.
4. **`frontend/src/lib/types.ts`:** add the field to the TypeScript interface.
5. **UI:** add an entry to the `FIELDS` array in `Controls.tsx` or `TrainingParams.tsx`.
6. **Docs:** the service README's variable table.

### Add an API endpoint
`monitor.py` (engine method, taking the lock and writing an event) → `api.py` (route and
response model) → `api.ts` (client function) → component. Write routes are protected
automatically: every non-GET under `/api/model/` goes through forward-auth. **GET endpoints are
public by design**, so never return anything sensitive from one.

### Add an event kind
Call `self.store.add_event(interval, "your_kind", "Human message", **data)` in the engine, and
add a short label to `KIND_LABELS` in `EventLog.tsx`.

### Add a chart or panel
Copy the structure of `ModelLossChart.tsx`:

- a `Panel` with a chart/table toggle;
- colours only from CSS tokens;
- a legend when there are two or more series;
- `isAnimationActive={false}` for live data;
- a tooltip.

Put the data fetch in `Dashboard.tsx` with `usePolling`.

### Change the database schema
Edit the SQLAlchemy model in `storage.py`. Because tables are recreated at startup, a
deploy picks up the change with no migration. That stops being true if you ever persist data
across restarts: introduce [Alembic](https://alembic.sqlalchemy.org/) first.

### Add a new service
1. Create `services/<name>/` with its own Dockerfile, README and tests.
2. Add it to `docker-compose.yml` (with a health check).
3. Add a route in the Caddyfile (with `forward_auth` if it needs a login).
4. Add a CI job.

---

## 13. Operating production

| Task | How |
|---|---|
| SSH in | `ssh root@142.93.51.106` (your key must be in `authorized_keys`) |
| Status / logs | `cd /opt/mlops-demo && docker compose ps` / `docker compose logs -f --tail=100 model` |
| Deploy | Merge to `main` (automatic). Manual fallback: `bash /opt/mlops-demo/deploy/droplet/deploy.sh` |
| Re-run a deploy | `gh run rerun <run-id> --repo ko222uky/data-drift-simulator`, or **Actions → Re-run** |
| Backups | `bash deploy/droplet/backup.sh /var/backups/mlops-demo` (Postgres dumps + artifacts); schedule it with cron as documented |
| Secrets | GitHub Actions secrets `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`. **Set them with `gh secret set … < file`, never by pasting.** App secrets live in `/opt/mlops-demo/.env` (mode 600) |
| DNS | `A` record `datadrift.kloworld.com → 142.93.51.106` at the domain's DNS provider. If that's Cloudflare, it must be **DNS only** (grey cloud) |
| TLS | Automatic (Caddy + Let's Encrypt), stored in the `caddy_data` volume. Don't delete it (rate limits) |

Remember that **every deploy restarts the model service**, which starts a new simulation
session. Runtime settings revert to `.env`, but MLflow history is kept.

Full runbook: [deployment.md](deployment.md).

---

## 14. Gotchas we've already hit

- **Pasted secrets get corrupted.** A private key pasted into GitHub's web form failed
  twice with `error in libcrypto`. Use `gh secret set NAME < file`.
- **Windows line endings.** `.gitattributes` forces LF for `*.sh`, `Dockerfile` and
  `Caddyfile`. Otherwise shell scripts break inside Linux containers. Git's "LF will be
  replaced by CRLF" warnings on other files are harmless.
- **Mermaid in Markdown:**
  - A semicolon inside a label ends the statement.
  - `<text>` inside a label is treated as HTML and disappears.
  - A `---` config block must be the diagram's first line.

  Check diagrams with the [Mermaid live editor](https://mermaid.live/).
- **MLflow and long Windows paths.** Installing MLflow under a very deep directory hits
  Windows' 260-character path limit. Keep checkouts shallow, or use WSL.
- **Git Bash path conversion.** Git Bash rewrites arguments like `/mlflow` into Windows paths.
  Prefix Docker commands with `MSYS_NO_PATHCONV=1`.
- **MLflow's host check.** A request with an unexpected `Host` header gets a 403
  (`Invalid Host header`). Keep `PUBLIC_HOST` / `PUBLIC_ORIGIN` correct.
- **Slow first boots on small droplets.** MLflow's first start runs migrations and takes over
  a minute, so health-check grace periods are generous on purpose (180 s for MLflow, 120 s
  for model).
- **Floating-point precision.** Observations are `float32`; the projection is fitted in
  `float64` so dragging a centre lands exactly.

---

## 15. Known limitations and ideas

These are deliberate simplifications. Each is a good first project:

- **Sessions don't survive restarts.** Simulator state (centres, RNG, interval) lives in
  memory. Persisting it would need DB migrations (Alembic) and a restore path in
  `MonitorEngine.initialize()`.
- **The model service is a single process.** Its state can't be replicated; scaling would
  mean moving the loop into a separate worker.
- **There's one operator account.** Moving to real users (hashed passwords, a user table)
  would stay inside the auth service.
- **Ground-truth labels arrive immediately.** Real systems get labels late; the loop would
  need to evaluate older batches.
- **The frontend has no automated tests.** Candidates:
  [Vitest](https://vitest.dev/) + [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
  for components, and [Playwright](https://playwright.dev/) for the drag and hover
  interactions (these were verified manually with a headless browser).
- **`types.ts` is hand-maintained.** It could be generated from FastAPI's OpenAPI schema
  (e.g. [openapi-typescript](https://openapi-ts.dev/)).
- **Server hardening.**
  - Set `PermitRootLogin prohibit-password` and add fail2ban; scanners hit SSH constantly.
    Password login is already off.
  - Consider a DigitalOcean Cloud Firewall.

---

## 16. External resources

**Containers and infrastructure**
- Docker: [Get started](https://docs.docker.com/get-started/) ·
  [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) ·
  [Compose file reference](https://docs.docker.com/reference/compose-file/)
- Caddy: [docs](https://caddyserver.com/docs/) ·
  [Caddyfile concepts](https://caddyserver.com/docs/caddyfile/concepts) ·
  [reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) ·
  [forward_auth](https://caddyserver.com/docs/caddyfile/directives/forward_auth) ·
  [automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- DigitalOcean: [Droplets](https://docs.digitalocean.com/products/droplets/) ·
  [Reserved IPs](https://docs.digitalocean.com/products/networking/reserved-ips/) ·
  [Cloud Firewalls](https://docs.digitalocean.com/products/networking/firewalls/)
- Cloudflare: [proxied vs DNS-only records](https://developers.cloudflare.com/dns/proxy-status/) ·
  [Let's Encrypt docs](https://letsencrypt.org/docs/)
- OpenSSH: [`authorized_keys` options (forced commands, `restrict`)](https://man.openbsd.org/sshd#AUTHORIZED_KEYS_FILE_FORMAT)

**Python backend**
- [FastAPI tutorial](https://fastapi.tiangolo.com/tutorial/) ·
  [Pydantic](https://docs.pydantic.dev/latest/) ·
  [pydantic-settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/)
- [SQLAlchemy 2.0 ORM quick start](https://docs.sqlalchemy.org/en/20/orm/quickstart.html) ·
  [Alembic](https://alembic.sqlalchemy.org/)
- [uv](https://docs.astral.sh/uv/) · [pytest](https://docs.pytest.org/)
- [PyJWT](https://pyjwt.readthedocs.io/)

**Machine learning and MLOps**
- PyTorch: [docs](https://pytorch.org/docs/stable/) ·
  [basics tutorial](https://pytorch.org/tutorials/beginner/basics/intro.html) ·
  [AdamW](https://pytorch.org/docs/stable/generated/torch.optim.AdamW.html)
- MLflow: [documentation](https://mlflow.org/docs/latest/) ·
  [tracking server architecture](https://mlflow.org/docs/latest/self-hosting/architecture/tracking-server)
- Background: [Google Cloud, "MLOps: continuous delivery and automation pipelines in ML"](https://cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning)

**Frontend**
- [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- React: [Learn React](https://react.dev/learn) ·
  [Hooks reference](https://react.dev/reference/react/hooks) ·
  [You might not need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- [Next.js docs](https://nextjs.org/docs) (plus the bundled `frontend/node_modules/next/dist/docs/`)
- [Tailwind CSS](https://tailwindcss.com/docs) · [Recharts API](https://recharts.github.io/en-US/api/)
- MDN: [Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) ·
  [HTTP cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies)

**Delivery and tooling**
- GitHub Actions: [docs](https://docs.github.com/en/actions) ·
  [workflow syntax](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions) ·
  [deploy keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
- [GitHub CLI manual](https://cli.github.com/manual/) · [actionlint](https://github.com/rhysd/actionlint)
- [Conventional Commits](https://www.conventionalcommits.org/) · [Mermaid](https://mermaid.js.org/intro/) ·
  [Mermaid live editor](https://mermaid.live/)

---

## 17. Keeping this guide current

An onboarding guide that has drifted from the code is worse than none. Treat it like code:
**a pull request that makes any statement here wrong updates this file in the same PR.**
Before opening a PR, check whether you:

| If your change… | …update |
|---|---|
| adds, renames or removes a module, component or script | the [reading order](#3-reading-order) table and that area's section |
| changes how the control loop, training, auth, routing or deploys behave | the matching section (§5–§11) |
| adds a setting, endpoint, event kind or panel in a new way | the [recipes](#12-recipes-how-to-make-common-changes) |
| changes a command, port, path, secret or tool version | [§2](#2-set-up-your-machine), [§11](#11-tests-ci-and-continuous-deployment) or [§13](#13-operating-production) |
| hits a surprising problem | [§14 Gotchas](#14-gotchas-weve-already-hit) |
| removes a limitation (or adds one) | [§15](#15-known-limitations-and-ideas) |

Every so often, check that the external links still resolve and that the setup steps in §2
still work on a fresh clone.

Welcome aboard!
