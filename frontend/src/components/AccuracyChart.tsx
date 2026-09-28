"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MetricPoint, ModelEvent, TrainingRun } from "@/lib/types";
import { Panel, SegmentedToggle } from "./Panel";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Contiguous interval ranges during which a drift was in progress. */
function driftRanges(metrics: MetricPoint[]): [number, number][] {
  const ranges: [number, number][] = [];
  let start: number | null = null;
  metrics.forEach((m, i) => {
    const drifting = m.drift_progress != null;
    if (drifting && start == null) start = m.interval;
    const next = metrics[i + 1];
    if (start != null && (!next || next.drift_progress == null)) {
      ranges.push([start, m.interval]);
      start = null;
    }
  });
  return ranges;
}

interface TooltipPayload {
  payload: MetricPoint;
}

type LaneKind = "train" | "val" | "mixed";
interface Lane {
  kind: LaneKind;
  from: number;
  to: number;
}

const LANE_STYLE: Record<LaneKind, { fill: string; label: string }> = {
  train: { fill: "var(--train)", label: "Training data" },
  val: { fill: "var(--validation)", label: "Validation data" },
  mixed: { fill: "var(--train)", label: "Training + validation (random rows)" },
};
// The lane sits along the bottom of the plot, where accuracy rarely goes, so it never
// competes with the full-height drift shading.
const LANE_TOP = 0.06;

/** Interval ranges a model version trained and validated on. */
function trainingLanes(run: TrainingRun): Lane[] {
  const from = run.data_from_interval;
  const to = run.interval;
  if (run.split_method === "temporal" && run.val_from_interval != null) {
    const lanes: Lane[] = [{ kind: "val", from: run.val_from_interval, to }];
    if (run.val_from_interval > from) lanes.unshift({ kind: "train", from, to: run.val_from_interval - 1 });
    return lanes;
  }
  return [{ kind: "mixed", from, to }];
}

function LaneSwatch({ kind }: { kind: LaneKind }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-4 shrink-0 rounded-sm"
      style={{ background: LANE_STYLE[kind].fill, opacity: 0.55 }}
    />
  );
}

function ChartTooltip({
  active,
  payload,
  lanes,
  version,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  lanes: Lane[];
  version?: number;
}) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  const lane = lanes.find((l) => m.interval >= l.from && m.interval <= l.to);
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-ink">Interval {m.interval}</div>
      <div className="tabular mt-1 grid grid-cols-[auto_auto] gap-x-3 text-ink-2">
        <span>Accuracy</span>
        <span className="text-right text-ink">{(m.accuracy * 100).toFixed(1)}%</span>
        <span>Loss</span>
        <span className="text-right text-ink">{m.loss.toFixed(3)}</span>
        <span>Model</span>
        <span className="text-right text-ink">v{m.model_version}</span>
        {m.drift_progress != null && (
          <>
            <span>Drift</span>
            <span className="text-right text-ink">{pct(m.drift_progress)}</span>
          </>
        )}
        {lane && (
          <>
            <span>Used by v{version}</span>
            <span className="flex items-center justify-end gap-1.5 text-ink">
              <LaneSwatch kind={lane.kind} />
              {lane.kind === "train" ? "training" : lane.kind === "val" ? "validation" : "train + val"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function AccuracyChart({
  metrics,
  events,
  threshold,
  highlightRun,
}: {
  metrics: MetricPoint[];
  events: ModelEvent[];
  threshold: number | undefined;
  /** Model version whose training/validation intervals are highlighted (chosen in the loss widget). */
  highlightRun: TrainingRun | null;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [showLanes, setShowLanes] = useState(true);
  const last = metrics[metrics.length - 1]?.interval ?? 0;
  const lanes = useMemo(() => (highlightRun ? trainingLanes(highlightRun) : []), [highlightRun]);
  const ranges = useMemo(() => driftRanges(metrics), [metrics]);
  const first = metrics[0]?.interval ?? 0;
  const deploys = useMemo(
    () => events.filter((e) => e.kind === "deployed" && e.interval >= first && e.interval > 0),
    [events, first],
  );

  return (
    <Panel
      title="Live accuracy per interval"
      subtitle="Share of each new batch the deployed model classifies correctly. Shaded spans mark data drift; vertical rules mark redeployments; the bottom lane marks the intervals the selected model version trained and validated on."
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
      {view === "chart" && highlightRun && (
        <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showLanes} onChange={(e) => setShowLanes(e.target.checked)} className="accent-accent" />
            Highlight v{highlightRun.version}&apos;s data
          </label>
          {showLanes &&
            lanes.map((l) => (
              <span key={l.kind} className="flex items-center gap-1.5">
                <LaneSwatch kind={l.kind} />
                {LANE_STYLE[l.kind].label} (t {l.from === l.to ? l.from : `${l.from}–${l.to}`})
              </span>
            ))}
        </div>
      )}
      {view === "chart" ? (
        <div className="h-72">
          {metrics.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-muted">Waiting for the first interval…</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics} margin={{ top: 16, right: 16, bottom: 4, left: -8 }}>
                <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
                {ranges.map(([a, b]) => (
                  <ReferenceArea
                    key={a}
                    x1={a}
                    x2={b}
                    fill="var(--ink)"
                    fillOpacity={0.06}
                    strokeOpacity={0}
                    label={{ value: "Drift", position: "insideTopLeft", fill: "var(--ink-2)", fontSize: 11 }}
                  />
                ))}
                {showLanes &&
                  lanes
                    .filter((l) => l.to >= first && l.from <= last)
                    .map((l) => (
                      <ReferenceArea
                        key={l.kind}
                        x1={Math.max(l.from - 0.5, first)}
                        x2={Math.min(l.to + 0.5, last)}
                        y1={0}
                        y2={LANE_TOP}
                        ifOverflow="hidden"
                        fill={LANE_STYLE[l.kind].fill}
                        fillOpacity={0.55}
                        stroke="var(--surface)"
                        strokeWidth={2}
                      />
                    ))}
                <XAxis
                  dataKey="interval"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  allowDecimals={false}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--axis)" }}
                />
                <YAxis
                  domain={[0, 1]}
                  ticks={[0, 0.25, 0.5, 0.75, 1]}
                  tickFormatter={pct}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                {deploys.map((e) => (
                  <ReferenceLine
                    key={e.id}
                    x={e.interval}
                    stroke="var(--ink-2)"
                    strokeWidth={1}
                    label={{ value: `v${e.data.version}`, position: "top", fill: "var(--ink-2)", fontSize: 11 }}
                  />
                ))}
                {threshold != null && (
                  <ReferenceLine
                    y={threshold}
                    stroke="var(--critical)"
                    strokeWidth={1}
                    label={{ value: `Threshold ${pct(threshold)}`, position: "insideBottomLeft", fill: "var(--ink-2)", fontSize: 11 }}
                  />
                )}
                <Tooltip
                  content={<ChartTooltip lanes={showLanes ? lanes : []} version={highlightRun?.version} />}
                  cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
                />
                <Line
                  type="linear"
                  dataKey="accuracy"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={{ r: 4, fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      ) : (
        <div className="h-72 overflow-auto">
          <table className="tabular w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface text-ink-2">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Interval</th>
                <th className="py-1.5 pr-3 text-right font-medium">Accuracy</th>
                <th className="py-1.5 pr-3 text-right font-medium">Loss</th>
                <th className="py-1.5 pr-3 text-right font-medium">Model</th>
                <th className="py-1.5 text-right font-medium">Drift</th>
              </tr>
            </thead>
            <tbody>
              {[...metrics].reverse().map((m) => (
                <tr key={m.interval} className="border-t border-line">
                  <td className="py-1 pr-3">{m.interval}</td>
                  <td className="py-1 pr-3 text-right">{(m.accuracy * 100).toFixed(1)}%</td>
                  <td className="py-1 pr-3 text-right">{m.loss.toFixed(3)}</td>
                  <td className="py-1 pr-3 text-right">v{m.model_version}</td>
                  <td className="py-1 text-right">{m.drift_progress == null ? "—" : pct(m.drift_progress)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
