"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePlotArea, useXAxisScale, useYAxisScale } from "recharts";

export interface HoverItem {
  key: string;
  x: number;
  y: number;
  /** Extra hit radius in px, so larger marks (e.g. centres) win ties. */
  hitBonus?: number;
}

const CURSOR_GAP = 14; // px between cursor and tooltip

/**
 * Nearest-point hover for dense scatter plots. Render it as the last child of a
 * Recharts `<ScatterChart>`.
 *
 * Recharts' built-in tooltip only fires while the cursor is exactly over a (tiny)
 * mark and animates between marks, so on a dense plot it flickers and "flies" around.
 * This layer instead:
 * - listens on the chart wrapper, so hovering directly over a mark works too;
 * - snaps to the nearest item within `radius` px of the cursor, so moving through the
 *   gaps between points stays continuous;
 * - positions the tooltip at the cursor by writing its transform directly on every
 *   pointer move, without re-rendering React (and thus without re-rendering the marks);
 * - re-renders only when the hovered item changes, and throttles work to one frame.
 */
export function NearestPointHover<T extends HoverItem>({
  items,
  container,
  radius = 18,
  renderTooltip,
  renderHighlight,
}: {
  items: T[];
  /** Positioned (relative) element that wraps the chart; the tooltip is portalled into it. */
  container: HTMLElement | null;
  radius?: number;
  renderTooltip: (item: T) => React.ReactNode;
  renderHighlight: (item: T, cx: number, cy: number) => React.ReactNode;
}) {
  const plot = usePlotArea();
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  // Pixel position of every item, recomputed only when data or scales change.
  const pixels = useMemo(() => {
    const xy = new Float64Array(items.length * 2);
    items.forEach((it, i) => {
      xy[2 * i] = xScale?.(it.x) ?? NaN;
      xy[2 * i + 1] = yScale?.(it.y) ?? NaN;
    });
    return xy;
  }, [items, xScale, yScale]);

  // Keyed (not indexed) so a data refresh never shows the wrong point's details.
  const indexByKey = useMemo(() => new Map(items.map((it, i) => [it.key, i])), [items]);
  const activeIndex = activeKey == null ? undefined : indexByKey.get(activeKey);

  const placeTooltip = useCallback(
    (clientX: number, clientY: number) => {
      const tip = tooltipRef.current;
      if (!tip || !container) return;
      const box = container.getBoundingClientRect();
      const x = clientX - box.left;
      const y = clientY - box.top;
      // Flip to the other side of the cursor near the right / bottom edges.
      const left = x + CURSOR_GAP + tip.offsetWidth > box.width ? x - CURSOR_GAP - tip.offsetWidth : x + CURSOR_GAP;
      const top = y + CURSOR_GAP + tip.offsetHeight > box.height ? y - CURSOR_GAP - tip.offsetHeight : y + CURSOR_GAP;
      tip.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, top)}px)`;
    },
    [container],
  );

  // Listen on the wrapper rather than on an overlay: Recharts draws the marks above any
  // custom layer, so an overlay would lose every event that lands on a mark. Pointer
  // events from anywhere in the chart, marks included, bubble up to the wrapper.
  useEffect(() => {
    if (!container || !plot) return;
    const clear = () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = null;
      container.style.cursor = "";
      setActiveKey(null);
    };
    const onMove = (e: PointerEvent) => {
      const { clientX, clientY } = e;
      lastPointer.current = { x: clientX, y: clientY };
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const svg = container.querySelector("svg.recharts-surface");
        if (!svg) return;
        const box = svg.getBoundingClientRect();
        const px = clientX - box.left;
        const py = clientY - box.top;
        const inPlot = px >= plot.x && px <= plot.x + plot.width && py >= plot.y && py <= plot.y + plot.height;
        if (!inPlot) return clear();
        let best = -1;
        let bestScore = Infinity;
        for (let i = 0; i < items.length; i++) {
          const d = Math.hypot(pixels[2 * i] - px, pixels[2 * i + 1] - py) - (items[i].hitBonus ?? 0);
          if (d < bestScore) {
            bestScore = d;
            best = i;
          }
        }
        const hit = best >= 0 && bestScore <= radius;
        container.style.cursor = hit ? "pointer" : "crosshair";
        setActiveKey(hit ? items[best].key : null);
        placeTooltip(clientX, clientY);
      });
    };
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", clear);
    return () => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", clear);
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [container, plot, items, pixels, radius, placeTooltip]);

  // The tooltip's size changes with its content; re-place it once the new content is in
  // the DOM so the edge flip uses the right width and height.
  useLayoutEffect(() => {
    if (activeKey != null && lastPointer.current) placeTooltip(lastPointer.current.x, lastPointer.current.y);
  }, [activeKey, placeTooltip]);

  if (!plot) return null;
  const active = activeIndex == null ? null : items[activeIndex];

  return (
    <g>
      {active && activeIndex != null && renderHighlight(active, pixels[2 * activeIndex], pixels[2 * activeIndex + 1])}
      {container &&
        createPortal(
          <div
            ref={tooltipRef}
            aria-hidden={!active}
            className="pointer-events-none absolute top-0 left-0 z-10"
            style={{ visibility: active ? "visible" : "hidden" }}
          >
            {active && renderTooltip(active)}
          </div>,
          container,
        )}
    </g>
  );
}
