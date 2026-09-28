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


def test_projection_lift_lands_exactly_and_keeps_hidden_directions():
    sim = make_sim()
    proj = Projection.fit(sim.sample(500).features)
    point = sim.centers[1]
    lifted = proj.lift(point, np.array([3.0, -2.0]))
    np.testing.assert_allclose(proj.transform(lifted), [3.0, -2.0], atol=1e-9)
    # The move lies entirely in the plotted plane: nothing changes orthogonal to it.
    residual = (lifted - point) - ((lifted - point) @ proj.components.T) @ proj.components
    np.testing.assert_allclose(residual, 0.0, atol=1e-9)


def test_place_center_during_drift_pins_that_class():
    sim = make_sim()
    sim.start_drift()
    sim.advance(0.25)
    pinned = np.full(5, 9.0)
    sim.place_center(0, pinned)
    sim.advance(0.25)
    np.testing.assert_allclose(sim.centers[0], pinned)  # stays where it was placed
    assert sim.drifting  # the other classes keep drifting


def test_set_drift_target_moves_only_that_class_when_idle():
    sim = make_sim()
    start = sim.centers.copy()
    goal = np.zeros(5)
    sim.set_drift_target(2, goal)
    assert sim.drifting
    sim.advance(0.5)
    np.testing.assert_allclose(sim.centers[2], start[2] + 0.5 * (goal - start[2]))
    np.testing.assert_allclose(np.delete(sim.centers, 2, axis=0), np.delete(start, 2, axis=0))
    assert sim.advance(0.5)
    np.testing.assert_allclose(sim.centers[2], goal)
