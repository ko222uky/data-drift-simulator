"use client";

import { useCallback, useMemo, useState } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, XAxis, YAxis } from "recharts";
import type { ProjectedCenter, ProjectedPoint, Projection } from "@/lib/types";
import type { ActionMessage } from "@/lib/useOperatorAction";
import { CenterDragLayer, type DragMode } from "./CenterDragLayer";
import { ClassSwatch, Marker, classColor, classShape } from "./classStyle";
import { NearestPointHover, type HoverItem } from "./NearestPointHover";
import { Panel, SegmentedToggle } from "./Panel";
import { StatusMessage } from "./ui";

type Scope = "all" | "window";

type Hovered = HoverItem &
  ({ kind: "point"; point: ProjectedPoint } | { kind: "centre" | "target"; center: ProjectedCenter });

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

function HoverCard({ item }: { item: Hovered }) {
  const label = item.kind === "point" ? item.point.label : item.center.label;
  const title =
    item.kind === "point"
      ? `Observation · class ${label}`
      : item.kind === "centre"
        ? `Centre P of class ${label}`
        : `Drift target P2 of class ${label}`;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs whitespace-nowrap shadow-sm">
      <div className="flex items-center gap-1.5 font-semibold text-ink">
        <ClassSwatch k={label} hollow={item.kind === "target"} />
        {title}
      </div>
      {item.kind === "point" && (
        <div className="tabular mt-1 grid grid-cols-[auto_auto] gap-x-3 text-ink-2">
          <span>Interval</span>
          <span className="text-right text-ink">{item.point.interval}</span>
          <span>Predicted</span>
          <span className="text-right text-ink">
            {item.point.prediction == null
              ? "— (training data)"
              : item.point.prediction === label
                ? `${item.point.prediction} ✓`
                : `${item.point.prediction} ✗`}
          </span>
          <span>In window W</span>
          <span className="text-right text-ink">{item.point.in_window ? "Yes" : "No"}</span>
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

export function ProjectionChart({
  projection,
  nClasses,
  canEdit = false,
  onMoveCenter,
  message = null,
}: {
  projection: Projection | null;
  nClasses: number;
  /** Signed-in operators can drag class centres. */
  canEdit?: boolean;
  onMoveCenter?: (label: number, x: number, y: number, mode: DragMode) => void;
  message?: ActionMessage | null;
}) {
  const [scope, setScope] = useState<Scope>("all");
  const [dragMode, setDragMode] = useState<DragMode>("move");
  const handleDrop = useCallback(
    (label: number, x: number, y: number) => onMoveCenter?.(label, x, y, dragMode),
    [onMoveCenter, dragMode],
  );
  const grabCentres = useCallback((item: Hovered) => (canEdit && item.kind === "centre" ? "grab" : "pointer"), [canEdit]);
  // Callback ref: the hover layer portals its tooltip into this positioned wrapper.
  const [chartBox, setChartBox] = useState<HTMLDivElement | null>(null);

  const { byClass, hoverItems, xDomain, yDomain } = useMemo(() => {
    const points = (projection?.points ?? []).filter((p) => scope === "all" || p.in_window);
    const groups = Array.from({ length: nClasses }, (_, k) => points.filter((p) => p.label === k));
    const anchors = [...(projection?.centers ?? []), ...(projection?.targets ?? [])];
    const xs = [...points.map((p) => p.x), ...anchors.map((c) => c.x)];
    const ys = [...points.map((p) => p.y), ...anchors.map((c) => c.y)];
    const hoverItems: Hovered[] = [
      ...points.map((p, i) => ({ key: `p${i}-${p.interval}`, x: p.x, y: p.y, kind: "point" as const, point: p })),
      // Centres and targets are drawn larger, so give them a bigger hit area.
      ...(projection?.centers ?? []).map((c) => ({ key: `c${c.label}`, x: c.x, y: c.y, hitBonus: 6, kind: "centre" as const, center: c })),
      ...(projection?.targets ?? []).map((c) => ({ key: `t${c.label}`, x: c.x, y: c.y, hitBonus: 6, kind: "target" as const, center: c })),
    ];
    return { byClass: groups, hoverItems, xDomain: niceDomain(xs), yDomain: niceDomain(ys) };
  }, [projection, scope, nClasses]);

  const windowCount = projection?.points.filter((p) => p.in_window).length ?? 0;

  return (
    <Panel
      title="Data in 2-D projection"
      subtitle={
        projection
          ? `PCA axes frozen at session start. Window W covers intervals ${projection.window_start}–${projection.interval} (${windowCount.toLocaleString()} points shown solid); older data is faded.${canEdit ? " Drag a centre P to move it, or to set where it drifts." : ""}`
          : "Loading…"
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <SegmentedToggle
              label="Dragging a centre"
              value={dragMode}
              onChange={setDragMode}
              options={[
                { value: "move", label: "Drag: move now" },
                { value: "drift", label: "Drag: drift there" },
              ]}
            />
          )}
          <SegmentedToggle
            label="Points shown"
            value={scope}
            onChange={setScope}
            options={[
              { value: "all", label: "W + older" },
              { value: "window", label: "W only" },
            ]}
          />
        </div>
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
      <div ref={setChartBox} className="relative h-96">
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
            <NearestPointHover
              items={hoverItems}
              container={chartBox}
              renderTooltip={(item) => <HoverCard item={item} />}
              cursorFor={grabCentres}
              renderHighlight={(item, cx, cy) => (
                <circle
                  cx={cx}
                  cy={cy}
                  r={item.kind === "point" ? 6 : 11}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
              )}
            />
            <CenterDragLayer
              centers={projection?.centers ?? []}
              container={chartBox}
              enabled={canEdit && !!onMoveCenter}
              mode={dragMode}
              onDrop={handleDrop}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <StatusMessage message={message} />
    </Panel>
  );
}
