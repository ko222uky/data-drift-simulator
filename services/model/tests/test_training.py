import numpy as np
import pytest

from model_service.config import TrainingConfig
from model_service.network import split_by_time, train
from model_service.simulator import DataSimulator


def test_temporal_split_holds_out_newest_whole_intervals():
    intervals = np.repeat(np.arange(1, 11), 100)  # 10 intervals x 100 rows
    split = split_by_time(intervals, validation_fraction=0.2, seed=0)
    assert split.method == "temporal"
    assert split.val_from_interval == 9
    assert set(intervals[split.val_idx]) == {9, 10}
    assert intervals[split.train_idx].max() == 8
    assert len(split.train_idx) + len(split.val_idx) == len(intervals)


def test_temporal_split_counts_intervals_not_rows():
    # Early in a session the window holds the big initial dataset (interval 0) plus a few
    # small intervals. A row-based 20% would hold out almost every drifted row.
    intervals = np.concatenate([np.zeros(2000, dtype=int), np.repeat(np.arange(1, 9), 100)])
    split = split_by_time(intervals, validation_fraction=0.2, seed=0)
    assert split.method == "temporal"
    assert set(intervals[split.val_idx]) == {7, 8}  # ceil(0.2 * 9 intervals) = 2
    assert set(intervals[split.train_idx]) == set(range(0, 7))


def test_temporal_split_rounds_up_to_at_least_one_interval():
    intervals = np.repeat(np.arange(1, 4), 100)  # 3 intervals; 5% -> ceil(0.15) = 1
    split = split_by_time(intervals, validation_fraction=0.05, seed=0)
    assert set(intervals[split.val_idx]) == {3}


def test_temporal_split_always_keeps_oldest_interval_for_training():
    # Initial data (interval 0) dwarfs the newer intervals.
    intervals = np.concatenate([np.zeros(2000, dtype=int), np.repeat([1, 2], 100)])
    split = split_by_time(intervals, validation_fraction=0.5, seed=0)
    assert split.method == "temporal"
    assert set(intervals[split.train_idx]) == {0}
    assert set(intervals[split.val_idx]) == {1, 2}


def test_single_interval_falls_back_to_random_split():
    split = split_by_time(np.zeros(500, dtype=int), validation_fraction=0.2, seed=0)
    assert split.method == "random"
    assert split.val_from_interval is None
    assert len(split.val_idx) == 100
    assert not set(split.val_idx) & set(split.train_idx)


@pytest.fixture
def noisy_data():
    sim = DataSimulator(n_features=8, n_classes=4, center_spread=4.0, noise_std=2.5, seed=3)
    batch = sim.sample(1000)
    intervals = np.repeat(np.arange(1, 11), 100)
    return batch.features, batch.labels, intervals


def test_early_stopping_restores_best_epoch(noisy_data):
    features, labels, intervals = noisy_data
    config = TrainingConfig(max_epochs=200, patience=3, weight_decay=0.0, learning_rate=0.02)
    result = train(features, labels, intervals, n_classes=4, config=config, seed=1)

    val_losses = [h["val_loss"] for h in result.history]
    assert result.stopped_early
    assert result.epochs_run < 200
    # Stopped exactly `patience` epochs after the best one...
    assert result.epochs_run - 1 - result.best_epoch == config.patience
    # ...and the reported metrics are those of the best epoch, not the last.
    assert result.val_loss == pytest.approx(min(val_losses), abs=1e-4)
    assert result.val_loss == val_losses[result.best_epoch]


def test_restored_weights_reproduce_best_epoch_metrics(noisy_data):
    from model_service.network import evaluate

    features, labels, intervals = noisy_data
    result = train(features, labels, intervals, n_classes=4, config=TrainingConfig(patience=3), seed=1)
    val = evaluate(result.model, features[result.split.val_idx], labels[result.split.val_idx])
    assert val.loss == pytest.approx(result.val_loss, rel=1e-5)
    assert val.accuracy == pytest.approx(result.val_accuracy)


def test_weight_decay_shrinks_weights(noisy_data):
    features, labels, intervals = noisy_data
    norms = {}
    for wd in (0.0, 0.5):
        config = TrainingConfig(max_epochs=20, patience=100, weight_decay=wd)
        model = train(features, labels, intervals, n_classes=4, config=config, seed=1).model
        norms[wd] = sum(float(p.norm()) for name, p in model.named_parameters() if "weight" in name)
    assert norms[0.5] < norms[0.0]


def test_random_split_method_ignores_time(noisy_data):
    features, labels, intervals = noisy_data  # 10 intervals x 100 rows
    config = TrainingConfig(split_method="random", validation_fraction=0.25, max_epochs=3)
    result = train(features, labels, intervals, n_classes=4, config=config, seed=1)
    assert result.split.method == "random"
    assert result.split.val_from_interval is None
    assert result.n_val == 250
    # Validation rows come from across the window, not just the newest intervals.
    assert len(set(intervals[result.split.val_idx])) > 5


def test_temporal_split_method_is_the_default(noisy_data):
    features, labels, intervals = noisy_data
    result = train(features, labels, intervals, n_classes=4, config=TrainingConfig(max_epochs=3), seed=1)
    assert result.split.method == "temporal"
    assert result.split.val_from_interval == 9


def test_interval_counts_for_a_temporal_split():
    intervals = np.repeat(np.arange(1, 6), 10)  # 5 intervals x 10 rows
    split = split_by_time(intervals, validation_fraction=0.4, seed=0)
    assert split.interval_counts(intervals) == [[1, 10, 0], [2, 10, 0], [3, 10, 0], [4, 0, 10], [5, 0, 10]]


def test_interval_counts_for_a_random_split_mix_every_interval():
    from model_service.network import split_random

    intervals = np.repeat(np.arange(1, 11), 100)
    split = split_random(len(intervals), validation_fraction=0.2, seed=0)
    counts = split.interval_counts(intervals)
    assert [c[0] for c in counts] == list(range(1, 11))
    assert all(n_train + n_val == 100 for _, n_train, n_val in counts)
    assert sum(n_val for *_, n_val in counts) == 200
    assert all(n_val > 0 for *_, n_val in counts)  # validation is drawn from every interval
