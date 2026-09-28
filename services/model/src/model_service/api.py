"""FastAPI application for the model service.

Read endpoints (GET) are public; every mutating endpoint is protected by the gateway,
which only forwards non-GET requests after the auth service has verified the caller.
The service itself trusts the gateway and is never exposed directly to the internet.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError

from .config import ConfigUpdate, MonitorConfig, ServiceSettings, TrainingConfig, TrainingConfigUpdate
from .monitor import MonitorEngine
from .schemas import Accepted, EventOut, MetricPoint, ProjectionView, Status, TrainingRunOut
from .storage import Store
from .tracking import Tracker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def create_app(settings: ServiceSettings | None = None) -> FastAPI:
    settings = settings or ServiceSettings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        store = Store(settings.database_url)
        tracker = Tracker(settings.mlflow_tracking_uri, settings.mlflow_experiment, settings.registered_model_name)
        engine = MonitorEngine(settings, store, tracker)
        app.state.engine = engine
        if settings.autostart:
            engine.start()
        yield
        engine.stop()

    app = FastAPI(
        title="Model service",
        description="Simulated data stream, PyTorch classifier, live monitoring and automatic retraining.",
        version="0.1.0",
        lifespan=lifespan,
    )

    def engine(request: Request) -> MonitorEngine:
        return request.app.state.engine

    @app.get("/health", tags=["ops"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/status", response_model=Status, tags=["monitoring"])
    def status(request: Request):
        return engine(request).status()

    @app.get("/metrics", response_model=list[MetricPoint], tags=["monitoring"])
    def metrics(request: Request, limit: int = Query(300, ge=1, le=5000)):
        return engine(request).store.recent_metrics(limit)

    @app.get("/events", response_model=list[EventOut], tags=["monitoring"])
    def events(request: Request, limit: int = Query(50, ge=1, le=500)):
        return engine(request).store.recent_events(limit)

    @app.get("/projection", response_model=ProjectionView, tags=["monitoring"])
    def projection(request: Request, max_points: int = Query(1500, ge=10, le=10000)):
        return engine(request).projection_view(max_points)

    @app.get("/config", response_model=MonitorConfig, tags=["control"])
    def get_config(request: Request):
        return engine(request).config

    @app.put("/config", response_model=MonitorConfig, tags=["control"])
    def put_config(request: Request, update: ConfigUpdate):
        try:
            return engine(request).update_config(update)
        except ValidationError as exc:  # values outside MonitorConfig's bounds
            raise HTTPException(422, jsonable_encoder(exc.errors(include_url=False, include_context=False))) from exc

    @app.get("/trainings", response_model=list[TrainingRunOut], tags=["training"])
    def trainings(
        request: Request,
        limit: int = Query(10, ge=1, le=100),
        include_history: bool = Query(True, description="False omits per-epoch curves (cheap run list)"),
    ):
        """Most recent training runs kept this session, newest first."""
        runs = engine(request).store.recent_training_runs(limit)
        if include_history:
            return runs
        return [TrainingRunOut.model_validate(r, from_attributes=True).model_copy(update={"history": []}) for r in runs]

    @app.get("/trainings/{version}", response_model=TrainingRunOut, tags=["training"])
    def training(request: Request, version: int):
        """One training run, with its per-epoch train/validation curves."""
        run = engine(request).store.get_training_run(version)
        if run is None:
            raise HTTPException(404, f"no training run v{version} in this session")
        return run

    @app.get("/training-config", response_model=TrainingConfig, tags=["training"])
    def get_training_config(request: Request):
        return engine(request).training_config

    @app.put("/training-config", response_model=TrainingConfig, tags=["training"])
    def put_training_config(request: Request, update: TrainingConfigUpdate):
        try:
            return engine(request).update_training_config(update)
        except ValidationError as exc:  # values outside TrainingConfig bounds
            raise HTTPException(422, jsonable_encoder(exc.errors(include_url=False, include_context=False))) from exc

    @app.post("/drift", response_model=Accepted, tags=["control"])
    def drift(request: Request):
        if engine(request).simulator is None:
            raise HTTPException(409, "simulation has not started yet")
        engine(request).start_drift()
        return Accepted(detail="drift started")

    @app.post("/retrain", response_model=Accepted, status_code=202, tags=["control"])
    def retrain(request: Request):
        engine(request).request("retrain")
        return Accepted(detail="retrain queued")

    @app.post("/pause", response_model=Accepted, tags=["control"])
    def pause(request: Request):
        engine(request).set_paused(True)
        return Accepted(detail="paused")

    @app.post("/resume", response_model=Accepted, tags=["control"])
    def resume(request: Request):
        engine(request).set_paused(False)
        return Accepted(detail="resumed")

    @app.post("/auto-retrain/pause", response_model=Accepted, tags=["control"])
    def pause_auto_retrain(request: Request):
        """Stop threshold-triggered retraining. The simulation and manual retrains continue."""
        engine(request).set_auto_retrain(False)
        return Accepted(detail="automatic retraining paused")

    @app.post("/auto-retrain/resume", response_model=Accepted, tags=["control"])
    def resume_auto_retrain(request: Request):
        """Re-enable threshold-triggered retraining; a retrain that is already due runs next interval."""
        engine(request).set_auto_retrain(True)
        return Accepted(detail="automatic retraining resumed")

    @app.post("/reset", response_model=Accepted, status_code=202, tags=["control"])
    def reset(request: Request):
        engine(request).request("reset")
        return Accepted(detail="reset queued")

    return app
