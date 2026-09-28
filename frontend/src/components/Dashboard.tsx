"use client";

import { useCallback, useState } from "react";
import { modelApi } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { AccuracyChart } from "./AccuracyChart";
import { Controls } from "./Controls";
import { EventLog } from "./EventLog";
import { ModelLossChart } from "./ModelLossChart";
import { ProjectionChart } from "./ProjectionChart";
import { StatTiles } from "./StatTiles";
import { TrainingParams } from "./TrainingParams";
import { TrainingRunsChart } from "./TrainingRunsChart";

const POLL_MS = 2000;

// Stable fetchers so polling does not restart on every render.
const fetchMetrics = () => modelApi.metrics(300);
const fetchEvents = () => modelApi.events(100);
const fetchProjection = () => modelApi.projection(1500);
const fetchTrainings = () => modelApi.trainings(6);
const fetchTrainingList = () => modelApi.trainingList(100);
const noRun = () => Promise.resolve(null);

export function Dashboard() {
  const status = usePolling(modelApi.status, POLL_MS);
  const metrics = usePolling(fetchMetrics, POLL_MS);
  const events = usePolling(fetchEvents, POLL_MS);
  const projection = usePolling(fetchProjection, POLL_MS * 2);
  const trainings = usePolling(fetchTrainings, POLL_MS * 2);
  const trainingList = usePolling(fetchTrainingList, POLL_MS * 2);

  // Model version shown in the loss widget: null follows the latest retrain. A pick that no
  // longer exists (e.g. after a session reset) falls back to the latest.
  const [pickedVersion, setPickedVersion] = useState<number | null>(null);
  const versions = trainingList.data ?? [];
  const pickedExists = pickedVersion != null && versions.some((r) => r.version === pickedVersion);
  const shownVersion = pickedExists ? pickedVersion : (versions[0]?.version ?? null);
  const fetchShownRun = useCallback(
    () => (shownVersion == null ? noRun() : modelApi.training(shownVersion)),
    [shownVersion],
  );
  const shownRunPoll = usePolling(fetchShownRun, POLL_MS * 2);
  // Ignore a response for the previously selected version while the new one loads.
  const shownRun = shownRunPoll.data?.version === shownVersion ? shownRunPoll.data : null;

  const { refresh: refreshStatus } = status;
  const { refresh: refreshMetrics } = metrics;
  const { refresh: refreshEvents } = events;
  const { refresh: refreshProjection } = projection;
  const { refresh: refreshTrainings } = trainings;
  const { refresh: refreshTrainingList } = trainingList;
  const refreshAll = useCallback(() => {
    refreshStatus();
    refreshMetrics();
    refreshEvents();
    refreshProjection();
    refreshTrainings();
    refreshTrainingList();
  }, [refreshStatus, refreshMetrics, refreshEvents, refreshProjection, refreshTrainings, refreshTrainingList]);

  const offline = status.error && !status.data;

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-xl font-semibold">Live model monitoring</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          A simulated process emits observations around hidden class centres. A PyTorch classifier predicts each batch;
          when accuracy stays below the threshold, it retrains on the recent window and redeploys.
        </p>
      </div>

      {status.error && (
        <div role="alert" className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          <span className="font-semibold text-critical">⚠ {offline ? "Model service unreachable" : "Connection problem"}</span>{" "}
          <span className="text-ink-2">— {status.error.message}. Retrying every {POLL_MS / 1000}s.</span>
        </div>
      )}

      <StatTiles status={status.data} />

      <AccuracyChart
        metrics={metrics.data ?? []}
        events={events.data ?? []}
        threshold={status.data?.config.accuracy_threshold}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProjectionChart projection={projection.data} nClasses={status.data?.problem.n_classes ?? 0} />
        </div>
        <Controls status={status.data} onChange={refreshAll} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TrainingRunsChart runs={trainings.data ?? []} />
        </div>
        <TrainingParams status={status.data} latestRun={trainings.data?.[0]} onChange={refreshAll} />
      </div>

      <ModelLossChart
        versions={versions}
        selected={pickedExists ? pickedVersion : null}
        onSelect={setPickedVersion}
        run={shownRun}
      />

      <EventLog events={events.data ?? []} />
    </main>
  );
}
