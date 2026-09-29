"""The monitoring engine: the control loop from the README workflow diagram.

Every interval (time t -> t+1):

1. The simulator generates ``n`` new observations around the current centres P
   (drifting towards P2 if a drift is in progress).
2. The deployed model predicts them; accuracy and loss are recorded in the DB and
   logged to MLflow.
3. If accuracy is below the threshold for ``i`` consecutive intervals -- and we are not
   inside a retry cool-down -- the model is retrained on the window W (the last ``w``
   intervals of data) and redeployed. An operator can pause this automatic retraining;
   breaches are still counted, and a retrain that came due while paused runs on the
   first interval after resuming.
4. If the retrained model's validation accuracy is still below the threshold, the next
   retrain may not happen until ``I`` intervals have passed.

Threading model: one background thread owns the loop and is the only thread that
trains. HTTP handlers read state under ``lock`` and hand heavier requests (manual
retrain, reset) to the loop thread via ``_pending`` so requests never block on training.
"""

import logging
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np

from .config import ConfigUpdate, MonitorConfig, ServiceSettings, TrainingConfig, TrainingConfigUpdate
from .network import Classifier, TrainResult, evaluate, train
from .projection import Projection
from .simulator import DataSimulator
from .storage import IntervalMetric, Store, TrainingRun
from .tracking import Tracker

log = logging.getLogger(__name__)

Phase = Literal["starting", "healthy", "degraded", "retraining", "cooldown"]
Action = Literal["retrain", "reset"]


@dataclass
class DeployedModel:
    version: int
    model: Classifier
    trained_at_interval: int
    reason: str
    val_accuracy: float
    n_train: int
    mlflow_run_id: str | None


class MonitorEngine:
    def __init__(self, settings: ServiceSettings, store: Store, tracker: Tracker):
        self.settings = settings
        self.store = store
        self.tracker = tracker
        self.config: MonitorConfig = settings.initial_monitor_config()
        self.training_config: TrainingConfig = settings.initial_training_config()

        self.lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._pending: list[Action] = []

        self.session_id = ""
        self.interval = 0
        self.paused = False
        self.auto_retrain = settings.auto_retrain
        # Continuous drift chains drift legs: each completed leg starts another towards new
        # random centres, so the data keeps wandering at rate r.
        self.continuous_drift = settings.continuous_drift
        self._suppression_logged = False  # one "retrain_suppressed" event per breach streak
        self.training = False
        self.consecutive_breaches = 0
        self.retry_at_interval: int | None = None
        self.last_accuracy: float | None = None
        self.simulator: DataSimulator | None = None
        self.projection: Projection | None = None
        self.deployed: DeployedModel | None = None

    # -- lifecycle -----------------------------------------------------------------

    def initialize(self) -> None:
        """Start a fresh session: new data, new projection, model v1 trained on D."""
        s = self.settings
        with self.lock:
            self.tracker.end_session()
            self.store.reset()
            self.session_id = uuid.uuid4().hex[:8]
            self.interval = 0
            self.consecutive_breaches = 0
            self.retry_at_interval = None
            self.last_accuracy = None
            self.deployed = None
            self.simulator = DataSimulator(s.n_features, s.n_classes, s.center_spread, s.noise_std, s.seed)
            initial = self.simulator.sample(s.initial_size)
            self.store.add_observations(0, initial.features, initial.labels, None)
            self.projection = Projection.fit(initial.features)
            self.tracker.start_session(self.session_id, {**self._problem_params(), **self.config.model_dump()})
            intervals = np.zeros(len(initial.labels), dtype=np.int64)
            self.store.add_event(0, "session_started", f"Session {self.session_id}: generated N={s.initial_size} observations")
        self._retrain(initial.features, initial.labels, intervals, reason="initial")

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="monitor-loop", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=30)
        self.tracker.end_session()

    def _run(self) -> None:
        try:
            self.initialize()
        except Exception:
            log.exception("Initial training failed")
        # The next interval is due interval_seconds after the previous one, recomputed on
        # every wake-up rather than fixed when the wait starts. Changing the setting (which
        # wakes this loop) therefore takes effect at once: shortening it runs the next
        # interval as soon as the new length has elapsed (immediately if it already has),
        # and lengthening it extends the current wait.
        last_step = time.monotonic()
        while not self._stop.is_set():
            try:
                self.run_pending()
                if not self.paused and time.monotonic() >= last_step + self.config.interval_seconds:
                    self.step()
                    last_step = time.monotonic()
            except Exception:
                log.exception("Monitor loop iteration failed")
                last_step = time.monotonic()
            timeout = None if self.paused else max(0.0, last_step + self.config.interval_seconds - time.monotonic())
            self._wake.wait(timeout)
            self._wake.clear()

    # -- requests from the API -----------------------------------------------------

    def request(self, action: Action) -> None:
        with self.lock:
            if action not in self._pending:
                self._pending.append(action)
        self._wake.set()

    def run_pending(self) -> None:
        with self.lock:
            actions, self._pending = self._pending, []
        for action in actions:
            if action == "reset":
                self.initialize()
            elif action == "retrain":
                self._retrain_on_window(reason="manual")

    def start_drift(self) -> None:
        with self.lock:
            self._start_drift_leg(f"Drift started towards new centres at r={self.config.drift_rate:.3f}/interval")

    def _start_drift_leg(self, message: str) -> None:
        target = self.simulator.start_drift()
        self.store.add_event(self.interval, "drift_started", message, target=target.round(3).tolist())

    def set_continuous_drift(self, enabled: bool) -> None:
        """Turn continuous drift on (start a leg now if idle) or off (the current leg finishes)."""
        with self.lock:
            if self.continuous_drift == enabled:
                return
            self.continuous_drift = enabled
            if enabled:
                self.store.add_event(
                    self.interval, "continuous_drift_on", f"Continuous drift on at r={self.config.drift_rate:.3f}/interval"
                )
                self.tracker.log_config(self.interval, {"continuous_drift": True})
                if self.simulator is not None and not self.simulator.drifting:
                    self._start_drift_leg("Continuous drift: moving towards new random centres")
            else:
                leg = " The current leg will finish." if self.simulator is not None and self.simulator.drifting else ""
                self.store.add_event(self.interval, "continuous_drift_off", "Continuous drift off." + leg)
                self.tracker.log_config(self.interval, {"continuous_drift": False})

    def move_center(self, label: int, x: float, y: float, mode: str) -> None:
        """Operator drag on the 2-D chart: place centre ``label`` (mode "move") or make it
        drift there at rate r (mode "drift"). (x, y) are projected coordinates."""
        with self.lock:
            sim, proj = self.simulator, self.projection
            if sim is None or proj is None:
                raise RuntimeError("simulation has not started yet")
            if not 0 <= label < sim.n_classes:
                raise ValueError(f"class {label} does not exist (0..{sim.n_classes - 1})")
            position = proj.lift(sim.centers[label], np.array([x, y]))
            where = f"({x:.2f}, {y:.2f})"
            if mode == "move":
                sim.place_center(label, position)
                self.store.add_event(self.interval, "center_moved", f"Class {label} centre moved to {where}", label=label, x=x, y=y)
            else:
                sim.set_drift_target(label, position)
                self.store.add_event(
                    self.interval,
                    "center_target_set",
                    f"Class {label} centre drifting to {where} at r={self.config.drift_rate:.3f}/interval",
                    label=label,
                    x=x,
                    y=y,
                )

    def set_paused(self, paused: bool) -> None:
        with self.lock:
            if self.paused != paused:
                self.paused = paused
                self.store.add_event(self.interval, "paused" if paused else "resumed", "Simulation " + ("paused" if paused else "resumed"))
        self._wake.set()

    def set_auto_retrain(self, enabled: bool) -> None:
        """Pause or resume threshold-triggered retraining. Manual retrains are unaffected."""
        with self.lock:
            if self.auto_retrain == enabled:
                return
            self.auto_retrain = enabled
            self._suppression_logged = False
            message = (
                "Automatic retraining resumed" + (" (a retrain is due and will run next interval)" if self._retrain_due() else "")
                if enabled
                else "Automatic retraining paused; breaches are still counted"
            )
            self.store.add_event(self.interval, "auto_retrain_resumed" if enabled else "auto_retrain_paused", message)
            self.tracker.log_config(self.interval, {"auto_retrain": enabled})

    def update_config(self, update: ConfigUpdate) -> MonitorConfig:
        with self.lock:
            changes = update.model_dump(exclude_none=True)
            self.config = MonitorConfig(**{**self.config.model_dump(), **changes})
            self.store.add_event(
                self.interval, "config_updated", ", ".join(f"{k}={v}" for k, v in changes.items()), **changes
            )
            self.tracker.log_config(self.interval, changes)
        self._wake.set()
        return self.config

    def update_training_config(self, update: TrainingConfigUpdate) -> TrainingConfig:
        """Change training hyper-parameters; they apply from the next training."""
        with self.lock:
            changes = update.model_dump(exclude_none=True)
            self.training_config = TrainingConfig(**{**self.training_config.model_dump(), **changes})
            self.store.add_event(
                self.interval,
                "training_config_updated",
                ", ".join(f"{k}={v}" for k, v in changes.items()),
                **changes,
            )
            self.tracker.log_config(self.interval, {f"training.{k}": v for k, v in changes.items()})
        return self.training_config

    # -- the interval step -----------------------------------------------------------

    def step(self) -> None:
        """Advance one interval: generate, predict, record, and retrain if the policy says so."""
        with self.lock:
            if self.deployed is None or self.simulator is None:
                return
            cfg = self.config
            self.interval += 1
            t = self.interval
            batch = self.simulator.sample(cfg.batch_size)
            result = evaluate(self.deployed.model, batch.features, batch.labels)
            self.store.add_observations(t, batch.features, batch.labels, result.predictions)
            # Keep W (last w intervals) plus w older intervals for the visualisation.
            self.store.prune_observations(keep_from_interval=t - 2 * cfg.window_intervals + 1)

            drift_progress = self.simulator.drift_progress if self.simulator.drifting else None
            if self.simulator.advance(cfg.drift_rate):
                self.store.add_event(t, "drift_completed", "Centres reached their new positions")
            if self.continuous_drift and not self.simulator.drifting:
                # Chain the next leg (also restarts drift after a session reset).
                self._start_drift_leg("Continuous drift: moving towards new random centres")

            self.last_accuracy = result.accuracy
            self.store.add_metric(
                IntervalMetric(
                    interval=t,
                    accuracy=result.accuracy,
                    loss=result.loss,
                    n=cfg.batch_size,
                    model_version=self.deployed.version,
                    drift_progress=drift_progress,
                )
            )
            self.tracker.log_interval(
                t,
                {
                    "live_accuracy": result.accuracy,
                    "live_loss": result.loss,
                    "model_version": self.deployed.version,
                    "drift_progress": drift_progress or 0.0,
                },
            )

            breached = result.accuracy < cfg.accuracy_threshold
            self.consecutive_breaches = self.consecutive_breaches + 1 if breached else 0
            if not breached:
                self._suppression_logged = False
            due = self._retrain_due()
            should_retrain = due and self.auto_retrain
            if due and not self.auto_retrain and not self._suppression_logged:
                self._suppression_logged = True
                self.store.add_event(
                    t,
                    "retrain_suppressed",
                    f"Retrain due (accuracy below {cfg.accuracy_threshold:.2f} for {self.consecutive_breaches} intervals) "
                    "but automatic retraining is paused",
                    accuracy=result.accuracy,
                )
            if should_retrain:
                self.store.add_event(
                    t,
                    "retrain_triggered",
                    f"Accuracy below {cfg.accuracy_threshold:.2f} for {self.consecutive_breaches} intervals",
                    accuracy=result.accuracy,
                )

        if should_retrain:
            self._retrain_on_window(reason="threshold")

    def _retrain_due(self) -> bool:
        """The policy calls for a retrain: enough consecutive breaches, and no cool-down."""
        in_cooldown = self.retry_at_interval is not None and self.interval < self.retry_at_interval
        return self.consecutive_breaches >= self.config.breach_intervals and not in_cooldown

    # -- training --------------------------------------------------------------------

    def _retrain_on_window(self, reason: str) -> None:
        with self.lock:
            window = self.store.load_observations(from_interval=self.interval - self.config.window_intervals + 1)
        if len(window.labels) < 20:
            log.warning("Not enough data in window to retrain (%d rows)", len(window.labels))
            return
        self._retrain(window.features, window.labels, window.intervals, reason=reason)

    def _retrain(self, features: np.ndarray, labels: np.ndarray, intervals: np.ndarray, reason: str) -> None:
        s = self.settings
        with self.lock:
            self.training = True
            version = (self.deployed.version if self.deployed else 0) + 1
            t = self.interval
            cfg = self.training_config
            window_intervals = self.config.window_intervals
        try:
            # Training and MLflow logging happen outside the lock so the API stays responsive.
            result: TrainResult = train(
                features, labels, intervals, n_classes=s.n_classes, config=cfg, seed=s.seed + version
            )
            params = {
                **self._problem_params(),
                **cfg.model_dump(),
                "reason": reason,
                "trained_at_interval": t,
                "window_intervals": window_intervals,
                "n_rows": len(labels),
                "split": result.split.method,
                "val_from_interval": result.split.val_from_interval,
                "n_train": result.n_train,
                "n_val": result.n_val,
            }
            run_id = self.tracker.log_training(version, self.session_id, reason, params, result, features[:5])
            self.store.add_training_run(
                TrainingRun(
                    version=version,
                    interval=t,
                    reason=reason,
                    split_method=result.split.method,
                    val_from_interval=result.split.val_from_interval,
                    data_from_interval=int(intervals.min()),
                    n_train=result.n_train,
                    n_val=result.n_val,
                    best_epoch=result.best_epoch,
                    epochs_run=result.epochs_run,
                    stopped_early=result.stopped_early,
                    train_accuracy=result.train_accuracy,
                    val_accuracy=result.val_accuracy,
                    val_loss=result.val_loss,
                    config=cfg.model_dump(),
                    history=result.history,
                    mlflow_run_id=run_id,
                )
            )
        finally:
            with self.lock:
                self.training = False

        with self.lock:
            self.deployed = DeployedModel(
                version=version,
                model=result.model,
                trained_at_interval=t,
                reason=reason,
                val_accuracy=result.val_accuracy,
                n_train=result.n_train,
                mlflow_run_id=run_id,
            )
            self.consecutive_breaches = 0
            self._suppression_logged = False
            threshold = self.config.accuracy_threshold
            recovered = result.val_accuracy >= threshold
            self.retry_at_interval = None if recovered else t + self.config.retry_intervals
            self.store.add_event(
                t,
                "deployed",
                f"Model v{version} deployed ({reason}); validation accuracy {result.val_accuracy:.3f} "
                f"(best epoch {result.best_epoch + 1} of {result.epochs_run}, {result.split.method} hold-out of {result.n_val} rows)",
                version=version,
                reason=reason,
                val_accuracy=result.val_accuracy,
                n_rows=len(labels),
                mlflow_run_id=run_id,
            )
            if not recovered:
                self.store.add_event(
                    t,
                    "retrain_insufficient",
                    f"Validation accuracy still below {threshold:.2f}; next retry no earlier than interval {self.retry_at_interval}",
                    retry_at_interval=self.retry_at_interval,
                )

    # -- read models ---------------------------------------------------------------------

    @property
    def phase(self) -> Phase:
        if self.deployed is None:
            return "starting"
        if self.training:
            return "retraining"
        if self.retry_at_interval is not None and self.interval < self.retry_at_interval:
            return "cooldown"
        if self.consecutive_breaches > 0:
            return "degraded"
        return "healthy"

    def status(self) -> dict[str, Any]:
        with self.lock:
            sim = self.simulator
            d = self.deployed
            return {
                "session_id": self.session_id,
                "interval": self.interval,
                "phase": self.phase,
                "paused": self.paused,
                "auto_retrain": self.auto_retrain,
                # A retrain the policy calls for but that is being held back by the pause.
                "retrain_suppressed": not self.auto_retrain and self.deployed is not None and self._retrain_due(),
                "last_accuracy": self.last_accuracy,
                "consecutive_breaches": self.consecutive_breaches,
                "retry_at_interval": self.retry_at_interval,
                "drift": {
                    "active": bool(sim and sim.drifting),
                    "progress": sim.drift_progress if sim and sim.drifting else None,
                    "continuous": self.continuous_drift,
                },
                "model": None
                if d is None
                else {
                    "version": d.version,
                    "trained_at_interval": d.trained_at_interval,
                    "reason": d.reason,
                    "val_accuracy": d.val_accuracy,
                    "n_train": d.n_train,
                    "mlflow_run_id": d.mlflow_run_id,
                },
                "problem": self._problem_params(),
                "config": self.config.model_dump(),
                "training_config": self.training_config.model_dump(),
                "mlflow_enabled": self.tracker.enabled,
            }

    def projection_view(self, max_points: int) -> dict[str, Any]:
        with self.lock:
            if self.projection is None or self.simulator is None:
                return {"interval": 0, "window_start": 0, "points": [], "centers": [], "targets": []}
            t = self.interval
            w = self.config.window_intervals
            window_start = t - w + 1
            data = self.store.load_observations(from_interval=t - 2 * w + 1)
            centers = self.projection.transform(self.simulator.centers)
            targets = (
                self.projection.transform(self.simulator.drift_target) if self.simulator.drift_target is not None else None
            )
            proj = self.projection

        idx = np.arange(len(data.labels))
        if len(idx) > max_points:
            # Deterministic, evenly spaced subsample so the plot does not flicker.
            idx = np.linspace(0, len(idx) - 1, max_points).astype(int)
        xy = proj.transform(data.features[idx]) if len(idx) else np.empty((0, 2))
        points = [
            {
                "x": round(float(p[0]), 3),
                "y": round(float(p[1]), 3),
                "label": int(data.labels[i]),
                "prediction": None if data.predictions[i] < 0 else int(data.predictions[i]),
                "interval": int(data.intervals[i]),
                "in_window": bool(data.intervals[i] >= window_start),
            }
            for p, i in zip(xy, idx, strict=True)
        ]
        return {
            "interval": t,
            "window_start": max(window_start, 0),
            "points": points,
            "centers": [{"label": k, "x": float(c[0]), "y": float(c[1])} for k, c in enumerate(centers)],
            "targets": []
            if targets is None
            else [{"label": k, "x": float(c[0]), "y": float(c[1])} for k, c in enumerate(targets)],
        }

    def _problem_params(self) -> dict[str, Any]:
        s = self.settings
        return {
            "n_features": s.n_features,
            "n_classes": s.n_classes,
            "initial_size": s.initial_size,
            "noise_std": s.noise_std,
            "center_spread": s.center_spread,
        }
