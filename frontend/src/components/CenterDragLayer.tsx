"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  usePlotArea,
  useXAxisInverseScale,
  useXAxisScale,
  useYAxisInverseScale,
  useYAxisScale,
} from "recharts";
import type { ProjectedCenter } from "@/lib/types";
import { Marker, classColor, classShape } from "./classStyle";

export type DragMode = "move" | "drift";

const GRAB_RADIUS = 14; // px: centres are drawn with r=7, so be generous

// DOM writes on the shared chart wrapper live outside the component (the wrapper is a prop).
function setTouchAction(el: HTMLElement, value: string) {
  el.style.touchAction = value;
}
function setCursor(el: HTMLElement, value: string) {
  el.style.cursor = value;
}
function setDragging(el: HTMLElement, on: boolean) {
  if (on) el.dataset.dragging = "1";
  else delete el.dataset.dragging;
}

interface Drag {
  label: number;
  fromX: number;
  fromY: number;
  x: number;
  y: number;
}

/**
 * Lets an operator drag a class centre on the projection chart. Render it inside the
 * Recharts `<ScatterChart>`. Like the hover layer, it listens on the chart wrapper, because
 * Recharts draws marks above custom layers.
 *
 * While dragging, the wrapper carries `data-dragging="1"` so the hover tooltip stands aside.
 * On release, the drop position is converted back to data coordinates and passed to `onDrop`.
 */
export function CenterDragLayer({
  centers,
  container,
  enabled,
  mode,
  onDrop,
}: {
  centers: ProjectedCenter[];
  container: HTMLElement | null;
  enabled: boolean;
  mode: DragMode;
  onDrop: (label: number, x: number, y: number) => void;
}) {
  const plot = usePlotArea();
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const xInverse = useXAxisInverseScale();
  const yInverse = useYAxisInverseScale();
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const pixels = useMemo(
    () => centers.map((c) => ({ label: c.label, x: xScale?.(c.x) ?? NaN, y: yScale?.(c.y) ?? NaN })),
    [centers, xScale, yScale],
  );

  useEffect(() => {
    if (!container || !plot || !enabled) return;
    // Let touch drags move centres instead of scrolling the page.
    setTouchAction(container, "none");

    const local = (e: PointerEvent) => {
      const svg = container.querySelector("svg.recharts-surface");
      const box = (svg ?? container).getBoundingClientRect();
      // Clamp to the plot area so a drop never lands off-chart.
      const x = Math.min(Math.max(e.clientX - box.left, plot.x), plot.x + plot.width);
      const y = Math.min(Math.max(e.clientY - box.top, plot.y), plot.y + plot.height);
      return { x, y };
    };
    const set = (d: Drag | null) => {
      dragRef.current = d;
      setDrag(d);
      setDragging(container, d != null);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = local(e);
      let best: (typeof pixels)[number] | null = null;
      let bestD = GRAB_RADIUS;
      for (const c of pixels) {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d <= bestD) {
          bestD = d;
          best = c;
        }
      }
      if (!best) return;
      e.preventDefault();
      container.setPointerCapture(e.pointerId);
      setCursor(container, "grabbing");
      set({ label: best.label, fromX: best.x, fromY: best.y, x: p.x, y: p.y });
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = local(e);
      set({ ...d, x: p.x, y: p.y });
    };
    const finish = (e: PointerEvent, commit: boolean) => {
      const d = dragRef.current;
      if (!d) return;
      if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
      setCursor(container, "");
      set(null);
      const moved = Math.hypot(d.x - d.fromX, d.y - d.fromY) > 3; // ignore plain clicks
      if (commit && moved && xInverse && yInverse) {
        onDrop(d.label, Number(xInverse(d.x)), Number(yInverse(d.y)));
      }
    };
    const onUp = (e: PointerEvent) => finish(e, true);
    const onCancel = (e: PointerEvent) => finish(e, false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current) {
        setCursor(container, "");
        set(null);
      }
    };

    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      setTouchAction(container, "");
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [container, plot, enabled, pixels, xInverse, yInverse, onDrop]);

  if (!drag) return null;
  const color = classColor(drag.label);
  return (
    <g pointerEvents="none">
      <line x1={drag.fromX} y1={drag.fromY} x2={drag.x} y2={drag.y} stroke="var(--ink-2)" strokeWidth={1.5} />
      <Marker shape={classShape(drag.label)} x={drag.x} y={drag.y} r={8} fill="var(--surface)" stroke={color} strokeWidth={2} />
      <text
        x={drag.x + 12}
        y={drag.y - 10}
        fontSize={11}
        fontWeight={600}
        fill="var(--ink)"
        stroke="var(--surface)"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {mode === "move" ? `Move P ${drag.label} here` : `Drift P ${drag.label} here`}
      </text>
    </g>
  );
}
