from model_service.config import ConfigUpdate
from model_service.monitor import MonitorEngine
from model_service.storage import Store
from model_service.tracking import Tracker


def test_initial_model_is_trained_and_healthy(engine):
    assert engine.deployed.version == 1
    assert engine.deployed.val_accuracy > 0.9
    engine.step()
    status = engine.status()
    assert status["interval"] == 1
    assert status["phase"] == "healthy"
    assert status["last_accuracy"] > 0.9


def test_drift_degrades_accuracy_and_triggers_retraining(engine):
    engine.start_drift()
    versions = set()
    for _ in range(12):
        engine.step()
        versions.add(engine.deployed.version)
    kinds = [e.kind for e in engine.store.recent_events(100)]
    assert "drift_completed" in kinds
    assert "retrain_triggered" in kinds
    assert max(versions) > 1
    # After drift has finished and the model has retrained on the window, it recovers.
    for _ in range(6):
        engine.step()
    assert engine.last_accuracy > 0.9


def test_observation_storage_is_bounded(engine):
    w = engine.config.window_intervals
    for _ in range(3 * w):
        engine.step()
    stored = engine.store.load_observations(from_interval=0)
    assert stored.intervals.min() == engine.interval - 2 * w + 1
    assert engine.store.count_observations() == 2 * w * engine.config.batch_size


def test_unrecovered_retrain_enters_cooldown(settings):
    # Heavily overlapping classes + a near-perfect threshold: every retrain "fails" validation.
    noisy = settings.model_copy(update={"noise_std": 3.0})
    engine = MonitorEngine(noisy, Store(noisy.database_url), Tracker("", "test", "test-model"))
    engine.initialize()
    engine.update_config(ConfigUpdate(accuracy_threshold=0.99, breach_intervals=1, retry_intervals=4))
    # The initial model already missed the threshold, so the session may start in cool-down.
    assert engine.retry_at_interval is not None
    while engine.deployed.version == 1:
        engine.step()
    assert engine.interval == 3  # retry_intervals from the fixture at initial training time
    assert engine.retry_at_interval == engine.interval + 4
    assert engine.phase == "cooldown"
    for _ in range(3):
        engine.step()
    assert engine.deployed.version == 2  # no retrain during cool-down
    engine.step()
    assert engine.deployed.version == 3  # retried once the cool-down elapsed


def test_manual_retrain_and_reset_run_via_pending_queue(engine):
    for _ in range(3):
        engine.step()
    engine.request("retrain")
    engine.run_pending()
    assert engine.deployed.version == 2
    assert engine.deployed.reason == "manual"
    old_session = engine.session_id
    engine.request("reset")
    engine.run_pending()
    assert engine.session_id != old_session
    assert engine.interval == 0
    assert engine.deployed.version == 1


def test_projection_view_marks_window(engine):
    for _ in range(6):
        engine.step()
    view = engine.projection_view(max_points=10_000)
    assert view["window_start"] == engine.interval - engine.config.window_intervals + 1
    in_window = {p["interval"] for p in view["points"] if p["in_window"]}
    assert min(in_window) == view["window_start"]
    assert len(view["centers"]) == engine.settings.n_classes
