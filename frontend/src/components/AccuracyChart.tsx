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

type LaneKind = "train" | "val";

/** How one interval's rows were used by the highlighted model version. */
interface LaneColumn {
  interval: number;
  nTrain: number;
  nVal: number;
}

const LANE_STYLE: Record<LaneKind, { fill: string; label: string }> = {
  train: { fill: "var(--train)", label: "Training data" },
  val: { fill: "var(--validation)", label: "Validation data" },
};
// The lane sits along the bottom of the plot, where accuracy rarely goes, so it never
// competes with the full-height drift shading. Each interval is a column split by row share:
// validation at the bottom, training above. A time-based split gives whole-colour columns;
// a random split shows every interval's actual train/validation mix.
const LANE_TOP = 0.12;

function laneColumns(run: TrainingRun): LaneColumn[] {
  return run.interval_split.map(([interval, nTrain, nVal]) => ({ interval, nTrain, nVal }));
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
  columns,
  version,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  columns: LaneColumn[];
  version?: number;
}) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  const column = columns.find((c) => c.interval === m.interval);
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
        {column && (
          <>
            <span className="col-span-2 mt-1 text-ink-2">Rows used by v{version}</span>
            <span className="flex items-center gap-1.5">
              <LaneSwatch kind="train" />
              Training
            </span>
            <span className="text-right text-ink">{column.nTrain}</span>
            <span className="flex items-center gap-1.5">
              <LaneSwatch kind="val" />
              Validation
            </span>
            <span className="text-right text-ink">{column.nVal}</span>
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
  const columns = useMemo(() => (highlightRun ? laneColumns(highlightRun) : []), [highlightRun]);
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
          {showLanes && (
            <>
              {(["train", "val"] as const).map((kind) => (
                <span key={kind} className="flex items-center gap-1.5">
                  <LaneSwatch kind={kind} />
                  {LANE_STYLE[kind].label}
                </span>
              ))}
              <span className="text-muted">
                {highlightRun.split_method === "random"
                  ? "Random split: each interval shows its own train / validation mix"
                  : "Time-based split: validation is the newest intervals"}
              </span>
            </>
          )}
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
                  columns
                    .filter((c) => c.interval >= first && c.interval <= last)
                    .flatMap((c) => {
                      const valTop = (LANE_TOP * c.nVal) / Math.max(1, c.nTrain + c.nVal);
                      const x1 = Math.max(c.interval - 0.5, first);
                      const x2 = Math.min(c.interval + 0.5, last);
                      // A 1px surface stroke on each segment leaves a 2px gap between neighbouring
                      // columns without eating the thin validation slice of a random split.
                      const segment = (kind: LaneKind, y1: number, y2: number) => (
                        <ReferenceArea
                          key={`${c.interval}-${kind}`}
                          x1={x1}
                          x2={x2}
                          y1={y1}
                          y2={y2}
                          ifOverflow="hidden"
                          fill={LANE_STYLE[kind].fill}
                          fillOpacity={0.55}
                          stroke="var(--surface)"
                          strokeWidth={1}
                        />
                      );
                      return [
                        c.nVal > 0 && segment("val", 0, valTop),
                        c.nTrain > 0 && segment("train", valTop, LANE_TOP),
                      ].filter(Boolean);
                    })}
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
                  content={<ChartTooltip columns={showLanes ? columns : []} version={highlightRun?.version} />}
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
