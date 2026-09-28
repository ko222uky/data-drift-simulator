"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, modelApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { MonitorConfig, Status } from "@/lib/types";
import { Panel } from "./Panel";

const FIELDS: { key: keyof MonitorConfig; label: string; symbol: string; step: number; min: number; max: number }[] = [
  { key: "accuracy_threshold", label: "Accuracy threshold", symbol: "", step: 0.01, min: 0.01, max: 0.99 },
  { key: "breach_intervals", label: "Breaches before retrain", symbol: "i", step: 1, min: 1, max: 100 },
  { key: "window_intervals", label: "Retraining window", symbol: "w", step: 1, min: 1, max: 200 },
  { key: "retry_intervals", label: "Retry interval", symbol: "I", step: 1, min: 1, max: 200 },
  { key: "drift_rate", label: "Drift rate", symbol: "r", step: 0.01, min: 0.01, max: 1 },
  { key: "batch_size", label: "Batch size", symbol: "n", step: 10, min: 10, max: 5000 },
  { key: "interval_seconds", label: "Seconds per interval", symbol: "", step: 0.5, min: 0.5, max: 3600 },
];

function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  const styles = {
    primary: "bg-accent text-accent-ink hover:opacity-90",
    secondary: "border border-line text-ink hover:bg-wash",
    danger: "border border-line text-critical hover:bg-wash",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Controls({ status, onChange }: { status: Status | null; onChange: () => void }) {
  const { user, invalidate } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

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

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: "ok", text: success });
      onChange();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) invalidate();
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const paused = status?.paused ?? false;

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

      {status && (
        // Keyed by the saved config so the draft re-seeds whenever the server-side policy changes.
        <PolicyForm key={JSON.stringify(status.config)} config={status.config} busy={busy} run={run} />
      )}
      {message && (
        <p role="status" className={`mt-3 text-xs ${message.tone === "error" ? "text-critical" : "text-ink-2"}`}>
          {message.tone === "error" ? "⚠ " : "✓ "}
          {message.text}
        </p>
      )}
    </Panel>
  );
}

function PolicyForm({
  config,
  busy,
  run,
}: {
  config: MonitorConfig;
  busy: boolean;
  run: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, String(config[f.key])])),
  );

  function save(e: React.FormEvent) {
    e.preventDefault();
    const changes: Partial<MonitorConfig> = {};
    for (const f of FIELDS) {
      const value = Number(draft[f.key]);
      if (!Number.isNaN(value) && value !== config[f.key]) changes[f.key] = value;
    }
    if (Object.keys(changes).length > 0) run(() => modelApi.updateConfig(changes), "Policy updated");
  }

  return (
    <form onSubmit={save} className="mt-5 border-t border-line pt-4">
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-ink-2 uppercase">Monitoring policy</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs text-ink-2">
            <span>
              {f.label}
              {f.symbol && <em className="ml-1 text-ink">{f.symbol}</em>}
            </span>
            <input
              type="number"
              step={f.step}
              min={f.min}
              max={f.max}
              required
              value={draft[f.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              className="tabular rounded-md border border-line bg-page px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
        ))}
      </div>
      <div className="mt-4">
        <Button type="submit" disabled={busy}>
          Save policy
        </Button>
      </div>
    </form>
  );
}
