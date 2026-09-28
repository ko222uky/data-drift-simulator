"""Deterministic 2-D projection for visualising the M-dimensional data.

PCA is fitted once on the initial dataset and then frozen. Keeping the axes fixed
matters: if we refitted every interval, the whole scatter plot would rotate and drift
would be impossible to see. The sign of each component is normalised so the same data
always produces the same picture.
"""

import numpy as np


class Projection:
    def __init__(self, mean: np.ndarray, components: np.ndarray):
        self.mean = mean  # (M,)
        self.components = components  # (2, M)

    @classmethod
    def fit(cls, features: np.ndarray) -> "Projection":
        # float64: the observations are float32, but dragging centres lifts 2-D positions
        # back through these components, which should be exact.
        features = np.asarray(features, dtype=np.float64)
        mean = features.mean(axis=0)
        _, _, vt = np.linalg.svd(features - mean, full_matrices=False)
        components = vt[:2]
        # Make the largest-magnitude loading of each component positive.
        signs = np.sign(components[np.arange(2), np.abs(components).argmax(axis=1)])
        return cls(mean, components * signs[:, None])

    def transform(self, features: np.ndarray) -> np.ndarray:
        return (np.asarray(features) - self.mean) @ self.components.T

    def lift(self, point: np.ndarray, target_xy: np.ndarray) -> np.ndarray:
        """Move an M-dimensional point so it projects exactly onto ``target_xy``.

        The move happens only within the plane of the two (orthonormal) components, so
        every direction the plot can't show is left unchanged. This is how a centre
        dragged on the 2-D chart becomes a new position in the full feature space.
        """
        delta = np.asarray(target_xy, dtype=float) - self.transform(point)
        return np.asarray(point, dtype=float) + delta @ self.components
