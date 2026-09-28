"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { ProjectedCenter, ProjectedPoint, Projection } from "@/lib/types";
import { ClassSwatch, Marker, classColor, classShape } from "./classStyle";
import { Panel, SegmentedToggle } from "./Panel";

type Scope = "all" | "window";

interface ShapeProps {
  cx?: number;
  cy?: number;
  payload?: ProjectedPoint;
}

function PointShape({ cx, cy, payload }: ShapeProps) {
  if (cx == null || cy == null || !payload) return null;
  // Points in W are solid; older points (kept for context) are faded.
  return (
    <Marker
      shape={classShape(payload.label)}
      x={cx}
      y={cy}
      r={3}
      fill={classColor(payload.label)}
      opacity={payload.in_window ? 0.85 : 0.18}
    />
  );
}

function CenterShape({ cx, cy, payload, target }: { cx?: number; cy?: number; payload?: ProjectedCenter; target?: boolean }) {
  if (cx == null || cy == null || !payload) return null;
  const color = classColor(payload.label);
  return (
    <g>
      <Marker
        shape={classShape(payload.label)}
        x={cx}
        y={cy}
        r={7}
        fill={target ? "var(--surface)" : color}
        stroke={target ? color : "var(--surface)"}
        strokeWidth={2}
      />
      <text
        x={cx + 11}
        y={cy - 9}
        fontSize={11}
        fontWeight={600}
        fill="var(--ink)"
        stroke="var(--surface)"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {target ? `P2 ${payload.label}` : `P ${payload.label}`}
      </text>
    </g>
  );
}

function PointTooltip({ active, payload }: { active?: boolean; payload?: { payload: ProjectedPoint | ProjectedCenter }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const isPoint = "interval" in p;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="flex items-center gap-1.5 font-semibold text-ink">
        <ClassSwatch k={p.label} />
        {isPoint ? `Observation · class ${p.label}` : `Centre of class ${p.label}`}
      </div>
      {isPoint && (
        <div className="tabular mt-1 grid grid-cols-[auto_auto] gap-x-3 text-ink-2">
          <span>Interval</span>
          <span className="text-right text-ink">{p.interval}</span>
          <span>Predicted</span>
          <span className="text-right text-ink">
            {p.prediction == null ? "— (training data)" : p.prediction === p.label ? `${p.prediction} ✓` : `${p.prediction} ✗`}
          </span>
          <span>In window W</span>
          <span className="text-right text-ink">{p.in_window ? "Yes" : "No"}</span>
        </div>
      )}
    </div>
  );
}

function niceDomain(values: number[]): [number, number] {
  if (!values.length) return [-1, 1];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const step = 2;
  return [Math.floor(lo / step) * step - step / 2, Math.ceil(hi / step) * step + step / 2];
}

export function ProjectionChart({ projection, nClasses }: { projection: Projection | null; nClasses: number }) {
  const [scope, setScope] = useState<Scope>("all");

  const { byClass, xDomain, yDomain } = useMemo(() => {
    const points = (projection?.points ?? []).filter((p) => scope === "all" || p.in_window);
    const groups = Array.from({ length: nClasses }, (_, k) => points.filter((p) => p.label === k));
    const anchors = [...(projection?.centers ?? []), ...(projection?.targets ?? [])];
    const xs = [...points.map((p) => p.x), ...anchors.map((c) => c.x)];
    const ys = [...points.map((p) => p.y), ...anchors.map((c) => c.y)];
    return { byClass: groups, xDomain: niceDomain(xs), yDomain: niceDomain(ys) };
  }, [projection, scope, nClasses]);

  const windowCount = projection?.points.filter((p) => p.in_window).length ?? 0;

  return (
    <Panel
      title="Data in 2-D projection"
      subtitle={
        projection
          ? `PCA axes frozen at session start. Window W covers intervals ${projection.window_start}–${projection.interval} (${windowCount.toLocaleString()} points shown solid); older data is faded.`
          : "Loading…"
      }
      actions={
        <SegmentedToggle
          label="Points shown"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "W + older" },
            { value: "window", label: "W only" },
          ]}
        />
      }
    >
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
        {Array.from({ length: nClasses }, (_, k) => (
          <li key={k} className="flex items-center gap-1.5">
            <ClassSwatch k={k} />
            Class {k}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="font-semibold text-ink">P k</span> current centre
        </li>
        {!!projection?.targets.length && (
          <li className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
              <circle r="4.5" fill="none" stroke="var(--ink-2)" strokeWidth="1.5" />
            </svg>
            <span className="font-semibold text-ink">P2 k</span> drift target
          </li>
        )}
      </ul>
      <div className="h-96">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 16, bottom: 4, left: -8 }}>
            <CartesianGrid stroke="var(--grid)" strokeWidth={1} />
            <XAxis
              type="number"
              dataKey="x"
              name="PC1"
              domain={xDomain}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--axis)" }}
              tickFormatter={(v: number) => v.toFixed(0)}
              label={{ value: "PC 1", position: "insideBottomRight", offset: -2, fill: "var(--muted)", fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="PC2"
              domain={yDomain}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => v.toFixed(0)}
              width={44}
            />
            <Tooltip content={<PointTooltip />} cursor={false} />
            {byClass.map((points, k) => (
              <Scatter
                key={k}
                name={`Class ${k}`}
                data={points}
                shape={<PointShape />}
                isAnimationActive={false}
              />
            ))}
            <Scatter
              name="Drift targets"
              data={projection?.targets ?? []}
              shape={<CenterShape target />}
              isAnimationActive={false}
            />
            <Scatter name="Centres" data={projection?.centers ?? []} shape={<CenterShape />} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
