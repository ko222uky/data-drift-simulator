import type { Phase, Status } from "@/lib/types";

const pct = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);

// Status colours are reserved for model state and always paired with an icon + label.
const PHASES: Record<Phase, { label: string; icon: string; color: string; help: string }> = {
  starting: { label: "Starting", icon: "◌", color: "var(--muted)", help: "Training the initial model" },
  healthy: { label: "Healthy", icon: "✓", color: "var(--good)", help: "Accuracy at or above threshold" },
  degraded: { label: "Degraded", icon: "!", color: "var(--warning)", help: "Accuracy below threshold" },
  retraining: { label: "Retraining", icon: "↻", color: "var(--accent)", help: "Training on window W" },
  cooldown: { label: "Retry cool-down", icon: "⏸", color: "var(--serious)", help: "Last retrain did not recover" },
};

function Tile({ label, children, footer }: { label: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="mt-1 flex-1">{children}</div>
      {footer && <div className="mt-2 text-xs text-muted">{footer}</div>}
    </div>
  );
}

export function StatTiles({ status }: { status: Status | null }) {
  const phase = status ? PHASES[status.phase] : PHASES.starting;
  const threshold = status?.config.accuracy_threshold;
  const drift = status?.drift;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <div className="col-span-2 lg:col-span-1">
        <Tile label="Live accuracy" footer={threshold != null ? `Threshold ${pct(threshold, 0)}` : undefined}>
          <div className="text-5xl font-semibold tracking-tight">{pct(status?.last_accuracy)}</div>
        </Tile>
      </div>

      <Tile
        label="Model state"
        footer={
          status?.phase === "cooldown" && status.retry_at_interval != null
            ? `Next retry at interval ${status.retry_at_interval}`
            : status && status.consecutive_breaches > 0
              ? `${status.consecutive_breaches} of ${status.config.breach_intervals} breaches before retrain`
              : phase.help
        }
      >
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span
            aria-hidden="true"
            className="grid size-6 place-items-center rounded-full text-sm text-white"
            style={{ background: phase.color }}
          >
            {phase.icon}
          </span>
          {phase.label}
          {status?.paused && <span className="rounded bg-wash px-1.5 py-0.5 text-xs font-medium text-ink-2">Paused</span>}
        </div>
      </Tile>

      <Tile
        label="Deployed model"
        footer={
          status?.model ? `Trained at interval ${status.model.trained_at_interval} · ${status.model.reason}` : undefined
        }
      >
        <div className="text-lg font-semibold">{status?.model ? `v${status.model.version}` : "—"}</div>
        <div className="text-xs text-ink-2">Validation {pct(status?.model?.val_accuracy)}</div>
      </Tile>

      <Tile label="Interval t" footer={status ? `n = ${status.config.batch_size} per ${status.config.interval_seconds}s` : undefined}>
        <div className="text-lg font-semibold">{status?.interval ?? "—"}</div>
        <div className="text-xs text-ink-2">Session {status?.session_id || "—"}</div>
      </Tile>

      <Tile label="Data drift" footer={drift?.active ? `r = ${status?.config.drift_rate} per interval` : "Centres stable"}>
        <div className="text-lg font-semibold">{drift?.active ? pct(drift.progress, 0) : "None"}</div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-wash"
          role="meter"
          aria-label="Drift progress"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={drift?.progress ?? 0}
        >
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(drift?.progress ?? 0) * 100}%` }} />
        </div>
      </Tile>
    </div>
  );
}
