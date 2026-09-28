"""Response models for the HTTP API (these also drive the OpenAPI docs at /docs)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel

from .config import MonitorConfig, TrainingConfig
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
    auto_retrain: bool
    retrain_suppressed: bool
    last_accuracy: float | None
    consecutive_breaches: int
    retry_at_interval: int | None
    drift: DriftState
    model: ModelInfo | None
    problem: dict[str, Any]
    config: MonitorConfig
    training_config: TrainingConfig
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


class EpochMetrics(BaseModel):
    train_loss: float
    train_accuracy: float
    val_loss: float
    val_accuracy: float


class TrainingRunOut(BaseModel):
    version: int
    interval: int
    created_at: datetime
    reason: str
    split_method: str
    val_from_interval: int | None
    n_train: int
    n_val: int
    best_epoch: int
    epochs_run: int
    stopped_early: bool
    train_accuracy: float
    val_accuracy: float
    val_loss: float
    config: TrainingConfig
    history: list[EpochMetrics]
    mlflow_run_id: str | None


class Accepted(BaseModel):
    detail: str
