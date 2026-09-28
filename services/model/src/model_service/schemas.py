"""Response models for the HTTP API (these also drive the OpenAPI docs at /docs)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel

from .config import MonitorConfig
from .monitor import Phase


class DriftState(BaseModel):
    active: bool
    progress: float | None


class ModelInfo(BaseModel):
    version: int
    trained_at_interval: int
    reason: str
    val_accuracy: float
    n_train: int
    mlflow_run_id: str | None


class Status(BaseModel):
    session_id: str
    interval: int
    phase: Phase
    paused: bool
    last_accuracy: float | None
    consecutive_breaches: int
    retry_at_interval: int | None
    drift: DriftState
    model: ModelInfo | None
    problem: dict[str, Any]
    config: MonitorConfig
    mlflow_enabled: bool


class MetricPoint(BaseModel):
    interval: int
    created_at: datetime
    accuracy: float
    loss: float
    n: int
    model_version: int
    drift_progress: float | None


class EventOut(BaseModel):
    id: int
    interval: int
    created_at: datetime
    kind: str
    message: str
    data: dict[str, Any]


class ProjectedPoint(BaseModel):
    x: float
    y: float
    label: int
    prediction: int | None
    interval: int
    in_window: bool


class ProjectedCenter(BaseModel):
    label: int
    x: float
    y: float


class ProjectionView(BaseModel):
    interval: int
    window_start: int
    points: list[ProjectedPoint]
    centers: list[ProjectedCenter]
    targets: list[ProjectedCenter]


class Accepted(BaseModel):
    detail: str
