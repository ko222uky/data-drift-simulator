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
import type { MetricPoint, ModelEvent } from "@/lib/types";
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

function ChartTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
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
      </div>
    </div>
  );
}

export function AccuracyChart({
  metrics,
  events,
  threshold,
}: {
  metrics: MetricPoint[];
  events: ModelEvent[];
  threshold: number | undefined;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const ranges = useMemo(() => driftRanges(metrics), [metrics]);
  const first = metrics[0]?.interval ?? 0;
  const deploys = useMemo(
    () => events.filter((e) => e.kind === "deployed" && e.interval >= first && e.interval > 0),
    [events, first],
  );

  return (
    <Panel
      title="Live accuracy per interval"
      subtitle="Share of each new batch the deployed model classifies correctly. Shaded spans mark data drift; vertical rules mark redeployments."
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
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} />
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
