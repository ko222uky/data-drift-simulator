"""PyTorch classifier and its training loop."""

from dataclasses import dataclass, field

import numpy as np
import torch
from torch import nn


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
class TrainResult:
    model: Classifier
    train_accuracy: float
    val_accuracy: float
    val_loss: float
    n_train: int
    n_val: int
    history: list[dict[str, float]] = field(default_factory=list)  # one entry per epoch


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


def train(
    features: np.ndarray,
    labels: np.ndarray,
    *,
    n_classes: int,
    hidden_units: int,
    epochs: int,
    learning_rate: float,
    batch_size: int,
    validation_fraction: float,
    seed: int,
) -> TrainResult:
    generator = torch.Generator().manual_seed(seed)
    x = torch.from_numpy(features)
    y = torch.from_numpy(labels)

    order = torch.randperm(len(x), generator=generator)
    n_val = max(1, int(len(x) * validation_fraction))
    val_idx, train_idx = order[:n_val], order[n_val:]
    x_train, y_train = x[train_idx], y[train_idx]

    torch.manual_seed(seed)
    model = Classifier(x.shape[1], n_classes, hidden_units)
    model.mean.copy_(x_train.mean(dim=0))
    model.std.copy_(x_train.std(dim=0).clamp_min(1e-6))
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)

    history: list[dict[str, float]] = []
    for _ in range(epochs):
        model.train()
        for batch in torch.randperm(len(x_train), generator=generator).split(batch_size):
            optimizer.zero_grad()
            loss = nn.functional.cross_entropy(model(x_train[batch]), y_train[batch])
            loss.backward()
            optimizer.step()
        train_eval = evaluate(model, features[train_idx.numpy()], labels[train_idx.numpy()])
        val_eval = evaluate(model, features[val_idx.numpy()], labels[val_idx.numpy()])
        history.append(
            {
                "train_loss": train_eval.loss,
                "train_accuracy": train_eval.accuracy,
                "val_loss": val_eval.loss,
                "val_accuracy": val_eval.accuracy,
            }
        )

    last = history[-1]
    return TrainResult(
        model=model,
        train_accuracy=last["train_accuracy"],
        val_accuracy=last["val_accuracy"],
        val_loss=last["val_loss"],
        n_train=len(train_idx),
        n_val=n_val,
        history=history,
    )
