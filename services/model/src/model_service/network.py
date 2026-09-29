"""PyTorch classifier and its training loop."""

import copy
import math
from dataclasses import dataclass, field

import numpy as np
import torch
from torch import nn

from .config import TrainingConfig


class Classifier(nn.Module):
    """MLP with the input standardisation baked in, so the saved model is self-contained.

    The mean/std buffers are fitted on the training window. After drift they no longer
    match the live data, which is part of why accuracy degrades until retraining.
    """

    def __init__(self, n_features: int, n_classes: int, hidden_units: int):
        super().__init__()
        self.register_buffer("mean", torch.zeros(n_features))
        self.register_buffer("std", torch.ones(n_features))
        self.layers = nn.Sequential(
            nn.Linear(n_features, hidden_units),
            nn.ReLU(),
            nn.Linear(hidden_units, hidden_units),
            nn.ReLU(),
            nn.Linear(hidden_units, n_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.layers((x - self.mean) / self.std)


@dataclass
class Split:
    """Which rows train and which validate.

    ``method`` is "temporal" when validation is the most recent intervals, or "random" when
    validation rows are sampled from the whole window (chosen via ``split_method``, or forced
    when every row comes from one interval, as with the initial dataset).
    """

    train_idx: np.ndarray
    val_idx: np.ndarray
    method: str
    val_from_interval: int | None  # first interval of the temporal hold-out

    def interval_counts(self, intervals: np.ndarray) -> list[list[int]]:
        """Rows per interval as ``[[interval, n_train, n_val], ...]``, ascending by interval.

        This is what the dashboard draws under the accuracy chart: whole intervals for a
        temporal split, and each interval's actual train/validation mix for a random one.
        """
        train = dict(zip(*np.unique(intervals[self.train_idx], return_counts=True), strict=True))
        val = dict(zip(*np.unique(intervals[self.val_idx], return_counts=True), strict=True))
        return [[int(i), int(train.get(i, 0)), int(val.get(i, 0))] for i in sorted(set(train) | set(val))]


@dataclass
class TrainResult:
    model: Classifier  # weights from the best epoch (lowest validation loss)
    train_accuracy: float  # at the best epoch
    val_accuracy: float  # at the best epoch
    val_loss: float  # at the best epoch
    n_train: int
    n_val: int
    best_epoch: int  # 0-based
    epochs_run: int
    stopped_early: bool
    split: Split
    history: list[dict[str, float]] = field(default_factory=list)  # one entry per epoch run


@dataclass
class Evaluation:
    accuracy: float
    loss: float
    predictions: np.ndarray


def evaluate(model: Classifier, features: np.ndarray, labels: np.ndarray) -> Evaluation:
    model.eval()
    with torch.no_grad():
        logits = model(torch.from_numpy(features))
        target = torch.from_numpy(labels)
        loss = nn.functional.cross_entropy(logits, target).item()
        predictions = logits.argmax(dim=1)
        accuracy = (predictions == target).float().mean().item()
    return Evaluation(accuracy, loss, predictions.numpy())


def split_by_time(intervals: np.ndarray, validation_fraction: float, seed: int) -> Split:
    """Hold out the most recent intervals for validation.

    The newest ``ceil(validation_fraction * number_of_intervals)`` intervals are held out,
    always leaving at least one interval to train on. Counting *intervals* rather than
    rows matters early in a session, when the window still contains the large initial
    dataset: a row-based 20% would then hold out almost all of the drifted data and
    train on stale data. Validating on the newest data estimates how the model will do
    on the *next* batch, which a random split cannot do while the data is drifting.
    """
    unique = np.unique(intervals)  # ascending
    if len(unique) < 2:
        # A single interval (e.g. the initial dataset): no time order, so split randomly.
        return split_random(len(intervals), validation_fraction, seed)
    n_held = min(max(1, math.ceil(validation_fraction * len(unique))), len(unique) - 1)
    val_from = int(unique[-n_held])
    is_val = intervals >= val_from
    return Split(np.flatnonzero(~is_val), np.flatnonzero(is_val), "temporal", val_from)


def split_random(n: int, validation_fraction: float, seed: int) -> Split:
    """Hold out a random ``validation_fraction`` of the rows, regardless of time."""
    n_val = min(max(1, int(round(n * validation_fraction))), n - 1)
    order = np.random.default_rng(seed).permutation(n)
    return Split(np.sort(order[n_val:]), np.sort(order[:n_val]), "random", None)


def split_data(intervals: np.ndarray, validation_fraction: float, method: str, seed: int) -> Split:
    """Split per the configured method: ``"temporal"`` (default) or ``"random"``."""
    if method == "random":
        return split_random(len(intervals), validation_fraction, seed)
    return split_by_time(intervals, validation_fraction, seed)


def train(
    features: np.ndarray,
    labels: np.ndarray,
    intervals: np.ndarray,
    *,
    n_classes: int,
    config: TrainingConfig,
    seed: int,
) -> TrainResult:
    """Train with AdamW and early stopping on validation loss.

    Training stops once validation loss has not improved for ``config.patience`` epochs
    (or at ``config.max_epochs``), and the weights from the best epoch are restored.
    """
    split = split_data(intervals, config.validation_fraction, config.split_method, seed)
    x_train = torch.from_numpy(features[split.train_idx])
    y_train = torch.from_numpy(labels[split.train_idx])
    x_val, y_val = features[split.val_idx], labels[split.val_idx]

    torch.manual_seed(seed)
    generator = torch.Generator().manual_seed(seed)
    model = Classifier(features.shape[1], n_classes, config.hidden_units)
    model.mean.copy_(x_train.mean(dim=0))
    model.std.copy_(x_train.std(dim=0).clamp_min(1e-6))
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.learning_rate, weight_decay=config.weight_decay)

    history: list[dict[str, float]] = []
    best_loss, best_epoch, best_state = float("inf"), 0, copy.deepcopy(model.state_dict())
    for epoch in range(config.max_epochs):
        model.train()
        for batch in torch.randperm(len(x_train), generator=generator).split(config.batch_size):
            optimizer.zero_grad()
            loss = nn.functional.cross_entropy(model(x_train[batch]), y_train[batch])
            loss.backward()
            optimizer.step()
        train_eval = evaluate(model, x_train.numpy(), y_train.numpy())
        val_eval = evaluate(model, x_val, y_val)
        history.append(
            {
                "train_loss": train_eval.loss,
                "train_accuracy": train_eval.accuracy,
                "val_loss": val_eval.loss,
                "val_accuracy": val_eval.accuracy,
            }
        )
        if val_eval.loss < best_loss - 1e-4:
            best_loss, best_epoch = val_eval.loss, epoch
            best_state = copy.deepcopy(model.state_dict())
        elif epoch - best_epoch >= config.patience:
            break

    model.load_state_dict(best_state)
    model.eval()
    best = history[best_epoch]
    return TrainResult(
        model=model,
        train_accuracy=best["train_accuracy"],
        val_accuracy=best["val_accuracy"],
        val_loss=best["val_loss"],
        n_train=len(split.train_idx),
        n_val=len(split.val_idx),
        best_epoch=best_epoch,
        epochs_run=len(history),
        stopped_early=len(history) < config.max_epochs,
        split=split,
        history=history,
    )
