"use client";

import Link from "next/link";
import { modelApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { MonitorConfig, Status } from "@/lib/types";
import { useOperatorAction } from "@/lib/useOperatorAction";
import { ConfigForm, type FieldSpec } from "./ConfigForm";
import { Panel } from "./Panel";
import { Button, StatusMessage, Switch } from "./ui";

const FIELDS: FieldSpec<MonitorConfig>[] = [
  { key: "accuracy_threshold", label: "Accuracy threshold", step: 0.01, min: 0.01, max: 0.99 },
  { key: "breach_intervals", label: "Breaches before retrain", symbol: "i", step: 1, min: 1, max: 100 },
  { key: "window_intervals", label: "Retraining window", symbol: "w", step: 1, min: 1, max: 200 },
  { key: "retry_intervals", label: "Retry interval", symbol: "I", step: 1, min: 1, max: 200 },
  { key: "drift_rate", label: "Drift rate", symbol: "r", step: 0.01, min: 0.01, max: 1 },
  { key: "batch_size", label: "Batch size", symbol: "n", step: 10, min: 10, max: 5000 },
  { key: "interval_seconds", label: "Seconds per interval", step: 0.5, min: 0.5, max: 3600 },
];

export function Controls({ status, onChange }: { status: Status | null; onChange: () => void }) {
  const { user } = useAuth();
  const { busy, message, run } = useOperatorAction(onChange);

  if (!user) {
    return (
      <Panel title="Controls" subtitle="Trigger drift, retrain, and tune the monitoring policy.">
        <p className="text-sm text-ink-2">
          The dashboard is public; controls need an operator session.{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </Panel>
    );
  }

  const paused = status?.paused ?? false;
  const autoRetrain = status?.auto_retrain ?? true;
  const continuousDrift = status?.drift.continuous ?? false;

  return (
    <Panel title="Controls" subtitle={`Signed in as ${user}`}>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" disabled={busy || !status} onClick={() => run(modelApi.drift, "Drift started")}>
          {status?.drift.active ? "Restart drift" : "Trigger drift"}
        </Button>
        <Button disabled={busy || !status} onClick={() => run(modelApi.retrain, "Retrain queued")}>
          Retrain now
        </Button>
        <Button
          disabled={busy || !status}
          onClick={() => run(paused ? modelApi.resume : modelApi.pause, paused ? "Resumed" : "Paused")}
        >
          {paused ? "Resume" : "Pause"}
        </Button>
        <Button
          variant="danger"
          disabled={busy || !status}
          onClick={() => {
            if (window.confirm("Start a new session? Current data and metrics will be cleared (MLflow history is kept)."))
              run(modelApi.reset, "Reset queued");
          }}
        >
          Reset session
        </Button>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <SwitchRow
          id="auto-retrain-label"
          title="Automatic retraining"
          description={
            autoRetrain
              ? "Retrains when accuracy stays below the threshold."
              : status?.retrain_suppressed
                ? "Paused. A retrain is due and will run on the next interval after you resume."
                : "Paused. Breaches are still counted; Retrain now still works."
          }
          checked={autoRetrain}
          disabled={busy || !status}
          onChange={(on) =>
            run(
              on ? modelApi.resumeAutoRetrain : modelApi.pauseAutoRetrain,
              on ? "Automatic retraining resumed" : "Automatic retraining paused",
            )
          }
        />
        <SwitchRow
          id="continuous-drift-label"
          title="Continuous drift"
          description={
            continuousDrift
              ? `Centres keep moving to new random positions at r = ${status?.config.drift_rate} per interval.`
              : status?.drift.active
                ? "Off. The current drift will finish, then the centres stay put."
                : "Off. Drift only happens when you trigger it."
          }
          checked={continuousDrift}
          disabled={busy || !status}
          onChange={(on) =>
            run(
              on ? modelApi.startContinuousDrift : modelApi.stopContinuousDrift,
              on ? "Continuous drift on" : "Continuous drift off",
            )
          }
        />
      </div>

      {status && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="mb-3 text-xs font-semibold tracking-wide text-ink-2 uppercase">Monitoring policy</h3>
          <ConfigForm
            key={JSON.stringify(status.config)}
            fields={FIELDS}
            config={status.config}
            busy={busy}
            submitLabel="Save policy"
            onSave={(changes) => run(() => modelApi.updateConfig(changes), "Policy updated")}
          />
        </div>
      )}
      <StatusMessage message={message} />
    </Panel>
  );
}

function SwitchRow({
  id,
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-line px-3 py-2.5">
      <div className="min-w-0">
        <div id={id} className="text-sm font-medium text-ink">
          {title}
        </div>
        <p className="text-xs text-ink-2">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} labelledBy={id} onChange={onChange} />
    </div>
  );
}
