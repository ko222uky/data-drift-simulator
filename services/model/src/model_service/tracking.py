"""MLflow integration.

MLflow is an observer, not a dependency of the control loop: if the tracking server is
unreachable, failures are logged and the simulation carries on. Each service session
produces:

* one long-lived ``monitoring-<session>`` run with a metric point per interval, and
* one ``train-v<N>`` run per (re)training with params, per-epoch curves, final
  validation metrics and the PyTorch model, registered as a new version of the
  registered model with the ``champion`` alias pointing at the deployed version.
"""

import logging
import time
from typing import Any

import numpy as np

from .network import Classifier, TrainResult

log = logging.getLogger(__name__)


class Tracker:
    def __init__(self, tracking_uri: str, experiment: str, registered_model_name: str):
        self.enabled = bool(tracking_uri)
        self.registered_model_name = registered_model_name
        self._experiment_name = experiment
        self._experiment_id: str | None = None
        self._monitoring_run_id: str | None = None
        self._client = None
        if self.enabled:
            import mlflow
            from mlflow.tracking import MlflowClient

            mlflow.set_tracking_uri(tracking_uri)
            self._client = MlflowClient(tracking_uri)

    def _experiment(self) -> str:
        if self._experiment_id is None:
            import mlflow

            self._experiment_id = mlflow.set_experiment(self._experiment_name).experiment_id
        return self._experiment_id

    def _safely(self, what: str, fn, *args: Any, **kwargs: Any) -> Any:
        if not self.enabled:
            return None
        try:
            return fn(*args, **kwargs)
        except Exception:  # noqa: BLE001 -- tracking must never break the control loop
            log.exception("MLflow: failed to %s", what)
            return None

    # -- monitoring run ------------------------------------------------------------

    def start_session(self, session_id: str, params: dict[str, Any]) -> None:
        def _start() -> None:
            run = self._client.create_run(
                self._experiment(),
                run_name=f"monitoring-{session_id}",
                tags={"kind": "monitoring", "session": session_id},
            )
            self._monitoring_run_id = run.info.run_id
            self._client.log_batch(self._monitoring_run_id, params=_params(params))

        self._safely("start monitoring run", _start)

    def end_session(self) -> None:
        if self._monitoring_run_id:
            self._safely("end monitoring run", self._client.set_terminated, self._monitoring_run_id)
            self._monitoring_run_id = None

    def log_interval(self, interval: int, metrics: dict[str, float]) -> None:
        if not self._monitoring_run_id:
            return

        def _log() -> None:
            from mlflow.entities import Metric

            ts = int(time.time() * 1000)
            batch = [Metric(k, float(v), ts, interval) for k, v in metrics.items()]
            self._client.log_batch(self._monitoring_run_id, metrics=batch)

        self._safely("log interval metrics", _log)

    def log_config(self, interval: int, config: dict[str, Any]) -> None:
        if self._monitoring_run_id:
            tags = {f"config.{k}@{interval}": str(v) for k, v in config.items()}
            self._safely("log config change", self._client.log_batch, self._monitoring_run_id, tags=_tags(tags))

    # -- training runs -------------------------------------------------------------

    def log_training(
        self,
        version: int,
        session_id: str,
        reason: str,
        params: dict[str, Any],
        result: TrainResult,
        input_example: np.ndarray,
    ) -> str | None:
        """Log a training run and register the model. Returns the MLflow run id."""

        def _log() -> str:
            import mlflow

            self._experiment()
            with mlflow.start_run(
                run_name=f"train-v{version}",
                tags={"kind": "training", "session": session_id, "reason": reason, "model_version": str(version)},
            ) as run:
                mlflow.log_params(params)
                for epoch, entry in enumerate(result.history):
                    mlflow.log_metrics(entry, step=epoch)
                mlflow.log_metrics(
                    {
                        "final_val_accuracy": result.val_accuracy,
                        "final_val_loss": result.val_loss,
                        "final_train_accuracy": result.train_accuracy,
                    }
                )
                # A failed model upload should not discard the run's params and metrics.
                self._safely("log model", self._log_model, result.model, input_example)
                return run.info.run_id

        return self._safely("log training run", _log)

    def _log_model(self, model: Classifier, input_example: np.ndarray) -> None:
        import mlflow.pytorch
        from mlflow.models import ModelSignature
        from mlflow.types import Schema, TensorSpec

        # MLflow's default traced (pt2) format needs a tensor signature and an input
        # example. Declaring the signature avoids inference, which would require scipy.
        n_classes = model.layers[-1].out_features
        signature = ModelSignature(
            inputs=Schema([TensorSpec(np.dtype(np.float32), (-1, input_example.shape[1]))]),
            outputs=Schema([TensorSpec(np.dtype(np.float32), (-1, n_classes))]),
        )
        info = mlflow.pytorch.log_model(
            model,
            name="model",
            signature=signature,
            input_example=input_example,
            registered_model_name=self.registered_model_name,
            # Pinning requirements skips MLflow's slow dependency inference.
            pip_requirements=["torch"],
        )
        if info.registered_model_version is not None:
            self._client.set_registered_model_alias(
                self.registered_model_name, "champion", str(info.registered_model_version)
            )


def _params(params: dict[str, Any]):
    from mlflow.entities import Param

    return [Param(k, str(v)) for k, v in params.items()]


def _tags(tags: dict[str, str]):
    from mlflow.entities import RunTag

    return [RunTag(k, v) for k, v in tags.items()]
