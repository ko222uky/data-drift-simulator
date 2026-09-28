"use client";

import Link from "next/link";
import { modelApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Status, TrainingConfig, TrainingRun } from "@/lib/types";
import { useOperatorAction } from "@/lib/useOperatorAction";
import { ConfigForm, type FieldSpec } from "./ConfigForm";
import { Panel } from "./Panel";
import { Button, StatusMessage } from "./ui";

const FIELDS: FieldSpec<TrainingConfig>[] = [
  { key: "max_epochs", label: "Max epochs", step: 1, min: 1, max: 500, help: "Upper bound; early stopping usually ends sooner" },
  { key: "patience", label: "Early-stopping patience", step: 1, min: 1, max: 100, help: "Epochs without a lower validation loss before stopping" },
  { key: "learning_rate", label: "Learning rate", step: "any", min: 0.00001, max: 1, help: "AdamW step size" },
  { key: "weight_decay", label: "Weight decay", step: "any", min: 0, max: 1, help: "AdamW decoupled weight decay; higher = stronger regularisation" },
  { key: "hidden_units", label: "Hidden units", step: 1, min: 4, max: 1024, help: "Width of each of the two hidden layers" },
  { key: "batch_size", label: "Mini-batch size", step: 1, min: 8, max: 4096 },
  {
    key: "split_method",
    kind: "choice",
    label: "Validation split",
    options: [
      { value: "temporal", label: "Recent intervals" },
      { value: "random", label: "Random rows" },
    ],
    help: "Time-based validates on the newest intervals (honest during drift); random samples rows from the whole window",
  },
  {
    key: "validation_fraction",
    label: "Validation share",
    step: 0.05,
    min: 0.05,
    max: 0.5,
    help: "Time-based: share of the window's intervals; random: share of rows",
    describe: (v) => {
      const val = Math.round(Number(v) * 100);
      return Number.isFinite(val) && val > 0 && val < 100 ? `Train : validation = ${100 - val} : ${val}` : null;
    },
  },
];

export function TrainingParams({
  status,
  latestRun,
  onChange,
}: {
  status: Status | null;
  latestRun: TrainingRun | undefined;
  onChange: () => void;
}) {
  const { user } = useAuth();
  const { busy, message, run } = useOperatorAction(onChange);
  const config = status?.training_config;

  // Settings apply from the next training; flag when the deployed model used different ones.
  const pending =
    config && latestRun && (Object.keys(config) as (keyof TrainingConfig)[]).some((k) => config[k] !== latestRun.config[k]);

  return (
    <Panel title="Training parameters" subtitle="AdamW with early stopping. Changes apply from the next training.">
      {!config ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <ConfigForm
            key={JSON.stringify(config)}
            fields={FIELDS}
            config={config}
            busy={busy}
            readOnly={!user}
            submitLabel="Save parameters"
            onSave={(changes) => run(() => modelApi.updateTrainingConfig(changes), "Saved: applies to the next training")}
          />
          {pending && (
            <p className="mt-3 text-xs text-ink-2">
              The deployed model {latestRun ? `v${latestRun.version} ` : ""}was trained with different settings.
            </p>
          )}
          {user ? (
            <div className="mt-3 flex items-center gap-2">
              <Button variant="primary" disabled={busy} onClick={() => run(modelApi.retrain, "Retrain queued")}>
                Retrain with these settings
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-2">
              Read-only.{" "}
              <Link href="/login" className="font-medium text-accent hover:underline">
                Sign in
              </Link>{" "}
              to tune.
            </p>
          )}
          <StatusMessage message={message} />
        </>
      )}
    </Panel>
  );
}
