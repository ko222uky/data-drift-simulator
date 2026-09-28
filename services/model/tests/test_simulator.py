import numpy as np

from model_service.projection import Projection
from model_service.simulator import DataSimulator


def make_sim() -> DataSimulator:
    return DataSimulator(n_features=5, n_classes=3, center_spread=4.0, noise_std=0.5, seed=1)


def test_samples_cluster_around_class_centres():
    sim = make_sim()
    batch = sim.sample(3000)
    assert batch.features.shape == (3000, 5)
    for k in range(3):
        np.testing.assert_allclose(batch.features[batch.labels == k].mean(axis=0), sim.centers[k], atol=0.1)


def test_drift_moves_linearly_and_finishes():
    sim = make_sim()
    start = sim.centers.copy()
    target = sim.start_drift()
    assert not sim.advance(0.25)
    np.testing.assert_allclose(sim.centers, start + 0.25 * (target - start))
    assert not sim.advance(0.5)
    assert sim.advance(0.5)  # overshoot is clamped and reported as finished
    np.testing.assert_allclose(sim.centers, target)
    assert not sim.drifting


def test_projection_is_deterministic():
    data = make_sim().sample(500).features
    a, b = Projection.fit(data), Projection.fit(data.copy())
    np.testing.assert_allclose(a.transform(data), b.transform(data))
    assert a.transform(data).shape == (500, 2)
