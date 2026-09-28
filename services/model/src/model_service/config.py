"""Configuration.

Two kinds of settings live here:

* ``ServiceSettings`` -- fixed for the lifetime of the process, read from environment
  variables prefixed ``MODEL_`` (e.g. ``MODEL_N_FEATURES=8``). Changing them requires a
  restart because they define the shape of the simulated problem.
* ``MonitorConfig`` -- the monitoring / retraining policy. Seeded from the environment
  at start-up and editable at runtime through ``PUT /config``.
"""

from pydantic import BaseModel, Field, model_validator
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


class ConfigUpdate(BaseModel):
    """Partial update for ``MonitorConfig``; unset fields are left unchanged."""

    batch_size: int | None = None
    interval_seconds: float | None = None
    accuracy_threshold: float | None = None
    breach_intervals: int | None = None
    window_intervals: int | None = None
    retry_intervals: int | None = None
    drift_rate: float | None = None

    @model_validator(mode="after")
    def _not_empty(self) -> "ConfigUpdate":
        if not self.model_dump(exclude_none=True):
            raise ValueError("at least one field must be provided")
        return self


class ServiceSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MODEL_", env_file=".env", extra="ignore")

    # Problem definition (M features, K latent classes, N initial observations).
    n_features: int = Field(8, ge=2, le=256)
    n_classes: int = Field(4, ge=2, le=20)
    initial_size: int = Field(2000, ge=100)
    center_spread: float = Field(4.0, gt=0, description="Class centres are drawn uniformly from [-spread, spread]^M")
    noise_std: float = Field(1.5, gt=0, description="Std-dev of observations around their class centre")
    seed: int = 7

    # Training.
    epochs: int = Field(30, ge=1)
    learning_rate: float = Field(1e-2, gt=0)
    hidden_units: int = Field(64, ge=4)
    train_batch_size: int = Field(128, ge=8)
    validation_fraction: float = Field(0.2, gt=0, lt=0.9)

    # Infrastructure.
    database_url: str = "sqlite:///./model_service.db"
    mlflow_tracking_uri: str = Field("", description="Empty disables MLflow logging")
    mlflow_experiment: str = "drift-monitoring"
    registered_model_name: str = "drift-classifier"
    autostart: bool = Field(True, description="Start the interval loop when the service boots")

    # Initial values for the runtime policy.
    batch_size: int = 100
    interval_seconds: float = 5.0
    accuracy_threshold: float = 0.85
    breach_intervals: int = 3
    window_intervals: int = 10
    retry_intervals: int = 5
    drift_rate: float = 0.05

    def initial_monitor_config(self) -> MonitorConfig:
        return MonitorConfig(**{name: getattr(self, name) for name in MonitorConfig.model_fields})
