import pytest

from model_service.config import ServiceSettings
from model_service.monitor import MonitorEngine
from model_service.storage import Store
from model_service.tracking import Tracker


@pytest.fixture
def settings(tmp_path) -> ServiceSettings:
    return ServiceSettings(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        mlflow_tracking_uri="",
        autostart=False,
        initial_size=600,
        epochs=15,
        batch_size=100,
        window_intervals=4,
        breach_intervals=2,
        retry_intervals=3,
        accuracy_threshold=0.9,
        drift_rate=0.5,
    )


@pytest.fixture
def engine(settings) -> MonitorEngine:
    eng = MonitorEngine(settings, Store(settings.database_url), Tracker("", "test", "test-model"))
    eng.initialize()
    return eng
