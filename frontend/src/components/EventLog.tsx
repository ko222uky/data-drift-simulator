import type { ModelEvent } from "@/lib/types";
import { Panel } from "./Panel";

const KIND_LABELS: Record<string, string> = {
  session_started: "Session",
  deployed: "Deployed",
  retrain_triggered: "Retrain",
  retrain_insufficient: "Retry wait",
  drift_started: "Drift",
  drift_completed: "Drift done",
  config_updated: "Config",
  training_config_updated: "Training cfg",
  paused: "Paused",
  resumed: "Resumed",
};

export function EventLog({ events }: { events: ModelEvent[] }) {
  return (
    <Panel title="Event log" subtitle="Newest first. Every training run is also logged to MLflow.">
      {events.length === 0 ? (
        <p className="text-sm text-muted">No events yet.</p>
      ) : (
        <ol className="max-h-80 divide-y divide-line overflow-auto text-sm">
          {events.map((e) => (
            <li key={e.id} className="grid grid-cols-[4.5rem_6.5rem_1fr] items-baseline gap-3 py-2">
              <span className="tabular text-xs text-muted">t = {e.interval}</span>
              <span className="w-fit rounded bg-wash px-1.5 py-0.5 text-xs font-medium text-ink-2">
                {KIND_LABELS[e.kind] ?? e.kind}
              </span>
              <span className="min-w-0 text-ink">
                {e.message}
                <time className="ml-2 text-xs text-muted" dateTime={e.created_at}>
                  {new Date(e.created_at).toLocaleTimeString()}
                </time>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
