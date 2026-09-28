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
        mean = features.mean(axis=0)
        _, _, vt = np.linalg.svd(features - mean, full_matrices=False)
        components = vt[:2]
        # Make the largest-magnitude loading of each component positive.
        signs = np.sign(components[np.arange(2), np.abs(components).argmax(axis=1)])
        return cls(mean, components * signs[:, None])

    def transform(self, features: np.ndarray) -> np.ndarray:
        return (np.asarray(features) - self.mean) @ self.components.T
