"""Configuration.

Three kinds of settings live here:

* ``ServiceSettings`` -- fixed for the lifetime of the process, read from environment
  variables prefixed ``MODEL_`` (e.g. ``MODEL_N_FEATURES=8``). Changing them requires a
  restart because they define the shape of the simulated problem. They also seed the
  initial values of the two runtime configs below.
* ``MonitorConfig`` -- the monitoring / retraining policy, editable via ``PUT /config``.
* ``TrainingConfig`` -- how each (re)training runs, editable via ``PUT /training-config``.
  Changes apply from the next training onwards.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field, create_model, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class MonitorConfig(BaseModel):
    """Runtime-tunable policy. Symbols match the README workflow diagram."""

    batch_size: int = Field(100, ge=10, le=5000, description="n: observations generated per interval")
    interval_seconds: float = Field(5.0, ge=0.5, le=3600, description="Wall-clock seconds between intervals")
    accuracy_threshold: float = Field(0.85, gt=0, lt=1, description="Live accuracy below this counts as a breach")
    breach_intervals: int = Field(3, ge=1, le=100, description="i: consecutive breaching intervals that trigger retraining")
    window_intervals: int = Field(10, ge=1, le=200, description="w: intervals of history in the retraining window W")
    retry_intervals: int = Field(5, ge=1, le=200, description="I: intervals to wait before retrying a retrain that did not recover")
    drift_rate: float = Field(0.05, gt=0, le=1, description="r: fraction of the path to the new centres covered per interval")


class TrainingConfig(BaseModel):
    """Runtime-tunable training hyper-parameters."""

    max_epochs: int = Field(50, ge=1, le=500, description="Upper bound on epochs; early stopping usually ends sooner")
    patience: int = Field(5, ge=1, le=100, description="Stop after this many epochs without a lower validation loss")
    learning_rate: float = Field(1e-2, gt=0, le=1, description="AdamW learning rate")
    weight_decay: float = Field(1e-3, ge=0, le=1, description="AdamW decoupled weight decay (L2-style regularisation)")
    hidden_units: int = Field(64, ge=4, le=1024, description="Width of each of the two hidden layers")
    batch_size: int = Field(128, ge=8, le=4096, description="Mini-batch size")
    validation_fraction: float = Field(
        0.2, ge=0.05, le=0.5, description="Validation share: of intervals (temporal split) or rows (random split)"
    )
    split_method: Literal["temporal", "random"] = Field(
        "temporal",
        description="temporal: validate on the newest intervals; random: validate on a random sample of rows",
    )


class _NonEmptyUpdate(BaseModel):
    @model_validator(mode="after")
    def _not_empty(self) -> Any:
        if not self.model_dump(exclude_none=True):
            raise ValueError("at least one field must be provided")
        return self


def _partial(model: type[BaseModel], name: str) -> type[BaseModel]:
    """A model with every field of ``model`` optional, for PATCH-style updates.

    Bounds are enforced when the update is merged into the full model.
    """
    fields = {k: (f.annotation | None, None) for k, f in model.model_fields.items()}
    return create_model(name, __base__=_NonEmptyUpdate, __doc__=f"Partial update for {model.__name__}", **fields)


ConfigUpdate = _partial(MonitorConfig, "ConfigUpdate")
TrainingConfigUpdate = _partial(TrainingConfig, "TrainingConfigUpdate")


class ServiceSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MODEL_", env_file=".env", extra="ignore")

    # Problem definition (M features, K latent classes, N initial observations).
    n_features: int = Field(8, ge=2, le=256)
    n_classes: int = Field(4, ge=2, le=20)
    initial_size: int = Field(2000, ge=100)
    center_spread: float = Field(4.0, gt=0, description="Class centres are drawn uniformly from [-spread, spread]^M")
    noise_std: float = Field(1.5, gt=0, description="Std-dev of observations around their class centre")
    seed: int = 7

    # Infrastructure.
    database_url: str = "sqlite:///./model_service.db"
    mlflow_tracking_uri: str = Field("", description="Empty disables MLflow logging")
    mlflow_experiment: str = "drift-monitoring"
    registered_model_name: str = "drift-classifier"
    autostart: bool = Field(True, description="Start the interval loop when the service boots")
    auto_retrain: bool = Field(True, description="Retrain automatically on threshold breaches (can be paused at runtime)")

    # Initial values for the runtime policy (MonitorConfig).
    batch_size: int = 100
    interval_seconds: float = 5.0
    accuracy_threshold: float = 0.85
    breach_intervals: int = 3
    window_intervals: int = 10
    retry_intervals: int = 5
    drift_rate: float = 0.05

    # Initial values for training (TrainingConfig).
    max_epochs: int = 50
    patience: int = 5
    learning_rate: float = 1e-2
    weight_decay: float = 1e-3
    hidden_units: int = 64
    train_batch_size: int = 128
    validation_fraction: float = 0.2
    split_method: Literal["temporal", "random"] = "temporal"

    def initial_monitor_config(self) -> MonitorConfig:
        return MonitorConfig(**{name: getattr(self, name) for name in MonitorConfig.model_fields})

    def initial_training_config(self) -> TrainingConfig:
        values = {name: getattr(self, name) for name in TrainingConfig.model_fields if name != "batch_size"}
        return TrainingConfig(**values, batch_size=self.train_batch_size)
