"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrainingRun } from "@/lib/types";
import { Panel, SegmentedToggle } from "./Panel";

// The latest run carries the accent; previous runs are recessive context in grey,
// older ones fainter, so "what just happened" reads first and history second.
const LATEST = "var(--accent)";
const PREVIOUS = "var(--muted)";
const previousOpacity = (age: number) => Math.max(0.25, 0.75 - 0.12 * age);

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const key = (r: TrainingRun) => `v${r.version}`;

function LineKey({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return (
    <svg width="18" height="8" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="4" x2="17" y2="4" stroke={color} strokeOpacity={opacity} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface TooltipEntry {
  dataKey?: string | number;
  value?: number;
  payload: { epoch: number };
}

function EpochTooltip({ active, payload, runs }: { active?: boolean; payload?: TooltipEntry[]; runs: TrainingRun[] }) {
  if (!active || !payload?.length) return null;
  const epoch = payload[0].payload.epoch;
  const values = new Map(payload.map((p) => [String(p.dataKey), p.value]));
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-ink">Epoch {epoch}</div>
      <table className="tabular mt-1 text-ink-2">
        <tbody>
          {runs.map((r, i) => {
            const v = values.get(key(r));
            if (v == null) return null;
            return (
              <tr key={r.version} className={i === 0 ? "font-semibold text-ink" : ""}>
                <td className="pr-2">
                  <LineKey color={i === 0 ? LATEST : PREVIOUS} opacity={i === 0 ? 1 : previousOpacity(i - 1)} />
                </td>
                <td className="pr-3">{key(r)}</td>
                <td className="text-right">{v.toFixed(3)}</td>
                <td className="pl-2 text-muted">{r.best_epoch + 1 === epoch ? "best" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Fact({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="text-sm font-semibold text-ink">{value}</div>
      {detail && <div className="text-xs text-muted">{detail}</div>}
    </div>
  );
}

function holdoutText(r: TrainingRun) {
  if (r.split_method === "random") return `Random ${Math.round(r.config.validation_fraction * 100)}% (one interval)`;
  return r.val_from_interval === r.interval
    ? `Interval ${r.interval}`
    : `Intervals ${r.val_from_interval}–${r.interval}`;
}

export function TrainingRunsChart({ runs }: { runs: TrainingRun[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const latest = runs[0];
  const previous = runs.slice(1);

  const data = useMemo(() => {
    const longest = Math.max(0, ...runs.map((r) => r.history.length));
    return Array.from({ length: longest }, (_, e) => {
      const row: Record<string, number> = { epoch: e + 1 };
      for (const r of runs) if (e < r.history.length) row[key(r)] = r.history[e].val_loss;
      return row;
    });
  }, [runs]);

  const previousLabel =
    previous.length === 0
      ? null
      : previous.length === 1
        ? key(previous[0])
        : `${key(previous[previous.length - 1])}–${key(previous[0])}`;

  return (
    <Panel
      title="Training runs · validation loss per epoch"
      subtitle="Validation is the most recent intervals of the training window. Training stops when validation loss stops improving; the dot marks the epoch whose weights were deployed."
      actions={
        <SegmentedToggle
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "chart", label: "Chart" },
            { value: "table", label: "Table" },
          ]}
        />
      }
    >
      {!latest ? (
        <div className="grid h-72 place-items-center text-sm text-muted">No training runs yet…</div>
      ) : view === "chart" ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact
              label="Latest run"
              value={`${key(latest)} · ${latest.reason}`}
              detail={`Trained at interval ${latest.interval}`}
            />
            <Fact
              label="Deployed epoch"
              value={`${latest.best_epoch + 1} of ${latest.epochs_run}`}
              detail={latest.stopped_early ? "Stopped early" : `Hit max epochs (${latest.config.max_epochs})`}
            />
            <Fact
              label="Validation"
              value={`${latest.val_loss.toFixed(3)} loss`}
              detail={`${pct(latest.val_accuracy)} accuracy · train ${pct(latest.train_accuracy)}`}
            />
            <Fact label="Hold-out" value={holdoutText(latest)} detail={`${latest.n_val} of ${latest.n_train + latest.n_val} rows`} />
          </div>

          <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
            <li className="flex items-center gap-1.5">
              <LineKey color={LATEST} />
              {key(latest)} (latest)
            </li>
            {previousLabel && (
              <li className="flex items-center gap-1.5">
                <LineKey color={PREVIOUS} opacity={0.6} />
                {previousLabel} (previous, older fainter)
              </li>
            )}
          </ul>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: -8 }}>
                <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
                <XAxis
                  dataKey="epoch"
                  type="number"
                  domain={[1, "dataMax"]}
                  allowDecimals={false}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--axis)" }}
                  label={{ value: "Epoch", position: "insideBottomRight", offset: -2, fill: "var(--muted)", fontSize: 11 }}
                />
                <YAxis
                  domain={[0, "auto"]}
                  tickFormatter={(v: number) => v.toFixed(2)}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip content={<EpochTooltip runs={runs} />} cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} />
                {/* Oldest first so newer runs draw on top; the latest run last of all. */}
                {[...previous].reverse().map((r) => (
                  <Line
                    key={r.version}
                    dataKey={key(r)}
                    stroke={PREVIOUS}
                    strokeOpacity={previousOpacity(previous.indexOf(r))}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                ))}
                <Line
                  dataKey={key(latest)}
                  stroke={LATEST}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={{ r: 4, fill: LATEST, stroke: "var(--surface)", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                <ReferenceDot
                  x={latest.best_epoch + 1}
                  y={latest.val_loss}
                  r={5}
                  fill={LATEST}
                  stroke="var(--surface)"
                  strokeWidth={2}
                  label={{
                    value: `deployed · ${latest.val_loss.toFixed(3)}`,
                    position: "top",
                    fill: "var(--ink)",
                    fontSize: 11,
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="tabular w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface text-ink-2">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Run</th>
                <th className="py-1.5 pr-3 font-medium">Reason</th>
                <th className="py-1.5 pr-3 text-right font-medium">t</th>
                <th className="py-1.5 pr-3 font-medium">Hold-out</th>
                <th className="py-1.5 pr-3 text-right font-medium">Epoch</th>
                <th className="py-1.5 pr-3 text-right font-medium">Val loss</th>
                <th className="py-1.5 pr-3 text-right font-medium">Val acc</th>
                <th className="py-1.5 pr-3 text-right font-medium">Train acc</th>
                <th className="py-1.5 font-medium">lr · decay · hidden</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.version} className="border-t border-line">
                  <td className="py-1 pr-3 font-medium">{key(r)}</td>
                  <td className="py-1 pr-3">{r.reason}</td>
                  <td className="py-1 pr-3 text-right">{r.interval}</td>
                  <td className="py-1 pr-3">
                    {holdoutText(r)} ({r.n_val})
                  </td>
                  <td className="py-1 pr-3 text-right">
                    {r.best_epoch + 1}/{r.epochs_run}
                  </td>
                  <td className="py-1 pr-3 text-right">{r.val_loss.toFixed(3)}</td>
                  <td className="py-1 pr-3 text-right">{pct(r.val_accuracy)}</td>
                  <td className="py-1 pr-3 text-right">{pct(r.train_accuracy)}</td>
                  <td className="py-1">
                    {r.config.learning_rate} · {r.config.weight_decay} · {r.config.hidden_units}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
