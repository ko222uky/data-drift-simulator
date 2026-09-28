"""Synthetic data stream with latent classes and controllable drift.

Each latent class k owns a centre P[k] in R^M. An observation of class k is
``P[k] + noise``. Drift moves every centre in a straight line towards a new, randomly
drawn target P2 at ``drift_rate`` of the total distance per interval, so the
distribution shifts smoothly rather than jumping.
"""

from dataclasses import dataclass

import numpy as np


@dataclass
class Batch:
    features: np.ndarray  # (n, M) float32
    labels: np.ndarray  # (n,) int64


class DataSimulator:
    def __init__(self, n_features: int, n_classes: int, center_spread: float, noise_std: float, seed: int):
        self.n_features = n_features
        self.n_classes = n_classes
        self.center_spread = center_spread
        self.noise_std = noise_std
        self._rng = np.random.default_rng(seed)
        self.centers = self._draw_centers()
        self._drift_origin: np.ndarray | None = None
        self.drift_target: np.ndarray | None = None
        self.drift_progress = 0.0

    @property
    def drifting(self) -> bool:
        return self.drift_target is not None

    def _draw_centers(self) -> np.ndarray:
        return self._rng.uniform(-self.center_spread, self.center_spread, size=(self.n_classes, self.n_features))

    def sample(self, n: int) -> Batch:
        labels = self._rng.integers(0, self.n_classes, size=n)
        noise = self._rng.normal(0.0, self.noise_std, size=(n, self.n_features))
        features = self.centers[labels] + noise
        return Batch(features.astype(np.float32), labels.astype(np.int64))

    def start_drift(self) -> np.ndarray:
        """Pick new target centres P2. Restarting mid-drift begins from the current centres."""
        self._drift_origin = self.centers.copy()
        self.drift_target = self._draw_centers()
        self.drift_progress = 0.0
        return self.drift_target

    def place_center(self, k: int, position: np.ndarray) -> None:
        """Move centre ``k`` to ``position`` immediately.

        During a drift, class k stops drifting and stays where it was placed (its origin
        and target both become the new position); the other classes carry on.
        """
        self.centers[k] = position
        if self.drift_target is not None and self._drift_origin is not None:
            self._drift_origin[k] = position
            self.drift_target[k] = position

    def set_drift_target(self, k: int, position: np.ndarray) -> None:
        """Send centre ``k`` drifting towards ``position``.

        The drift restarts from the current centres: classes already drifting keep their
        targets, idle classes stay put, and progress resets to 0.
        """
        target = self.drift_target.copy() if self.drift_target is not None else self.centers.copy()
        target[k] = position
        self._drift_origin = self.centers.copy()
        self.drift_target = target
        self.drift_progress = 0.0

    def advance(self, rate: float) -> bool:
        """Move one interval along the drift path. Returns True when the drift just finished."""
        if self.drift_target is None or self._drift_origin is None:
            return False
        self.drift_progress = min(1.0, self.drift_progress + rate)
        self.centers = self._drift_origin + self.drift_progress * (self.drift_target - self._drift_origin)
        if self.drift_progress >= 1.0:
            self._drift_origin = None
            self.drift_target = None
            return True
        return False
