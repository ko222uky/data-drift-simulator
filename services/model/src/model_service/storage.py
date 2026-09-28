"""Persistence for the observation window, per-interval metrics and the event log.

Only the retraining window W plus ``w`` older intervals of observations are kept (see
the README); older rows are pruned every interval, so storage stays bounded no matter
how long the demo runs. Metrics and events are small and kept for the whole session.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import numpy as np
from sqlalchemy import JSON, DateTime, Float, Integer, String, create_engine, delete, func, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


def _now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class Observation(Base):
    __tablename__ = "observations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    interval: Mapped[int] = mapped_column(Integer, index=True)
    features: Mapped[list[float]] = mapped_column(JSON)
    label: Mapped[int] = mapped_column(Integer)
    prediction: Mapped[int | None] = mapped_column(Integer, nullable=True)


class IntervalMetric(Base):
    __tablename__ = "interval_metrics"

    interval: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    accuracy: Mapped[float] = mapped_column(Float)
    loss: Mapped[float] = mapped_column(Float)
    n: Mapped[int] = mapped_column(Integer)
    model_version: Mapped[int] = mapped_column(Integer)
    drift_progress: Mapped[float | None] = mapped_column(Float, nullable=True)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    interval: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    kind: Mapped[str] = mapped_column(String(32))
    message: Mapped[str] = mapped_column(String(500))
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


@dataclass
class WindowData:
    features: np.ndarray
    labels: np.ndarray
    predictions: np.ndarray  # -1 where no prediction was made (initial training data)
    intervals: np.ndarray


class Store:
    def __init__(self, database_url: str):
        connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
        self.engine = create_engine(database_url, connect_args=connect_args, pool_pre_ping=True)
        self._sessions = sessionmaker(self.engine, expire_on_commit=False)

    def reset(self) -> None:
        """Drop all simulation state. Called at start-up: each process run is a new session."""
        Base.metadata.drop_all(self.engine)
        Base.metadata.create_all(self.engine)

    def session(self) -> Session:
        return self._sessions()

    def add_observations(
        self, interval: int, features: np.ndarray, labels: np.ndarray, predictions: np.ndarray | None
    ) -> None:
        preds = [None] * len(labels) if predictions is None else predictions.tolist()
        rows = [
            {"interval": interval, "features": f, "label": label, "prediction": p}
            for f, label, p in zip(features.tolist(), labels.tolist(), preds, strict=True)
        ]
        with self.session() as s, s.begin():
            s.execute(Observation.__table__.insert(), rows)

    def prune_observations(self, keep_from_interval: int) -> int:
        with self.session() as s, s.begin():
            result = s.execute(delete(Observation).where(Observation.interval < keep_from_interval))
            return result.rowcount or 0

    def load_observations(self, from_interval: int) -> WindowData:
        with self.session() as s:
            rows = s.execute(
                select(Observation.features, Observation.label, Observation.prediction, Observation.interval)
                .where(Observation.interval >= from_interval)
                .order_by(Observation.id)
            ).all()
        if not rows:
            empty = np.empty(0, dtype=np.int64)
            return WindowData(np.empty((0, 0), dtype=np.float32), empty, empty, empty)
        return WindowData(
            features=np.array([r[0] for r in rows], dtype=np.float32),
            labels=np.array([r[1] for r in rows], dtype=np.int64),
            predictions=np.array([-1 if r[2] is None else r[2] for r in rows], dtype=np.int64),
            intervals=np.array([r[3] for r in rows], dtype=np.int64),
        )

    def count_observations(self) -> int:
        with self.session() as s:
            return s.scalar(select(func.count()).select_from(Observation)) or 0

    def add_metric(self, metric: IntervalMetric) -> None:
        with self.session() as s, s.begin():
            s.add(metric)

    def recent_metrics(self, limit: int) -> list[IntervalMetric]:
        with self.session() as s:
            rows = s.scalars(select(IntervalMetric).order_by(IntervalMetric.interval.desc()).limit(limit)).all()
        return list(reversed(rows))

    def add_event(self, interval: int, kind: str, message: str, **data: Any) -> Event:
        event = Event(interval=interval, kind=kind, message=message, data=data)
        with self.session() as s, s.begin():
            s.add(event)
        return event

    def recent_events(self, limit: int) -> list[Event]:
        with self.session() as s:
            rows = s.scalars(select(Event).order_by(Event.id.desc()).limit(limit)).all()
        return list(rows)
