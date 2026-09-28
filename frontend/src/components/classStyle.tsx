// Identity encoding for latent classes: colour AND shape, so classes stay distinguishable
// for colour-blind readers and when there are more classes than safe colours.

const SHAPES = ["circle", "square", "triangle", "diamond", "cross", "triangle-down", "hexagon", "star"] as const;
export type ShapeName = (typeof SHAPES)[number];

export const classColor = (k: number) => `var(--class-${k % 8})`;
export const classShape = (k: number): ShapeName => SHAPES[k % SHAPES.length];

/** SVG path for a marker of the given shape centred on (0, 0) with radius r. */
function shapePath(shape: ShapeName, r: number): string {
  const poly = (points: [number, number][]) => "M" + points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L") + "Z";
  const ring = (n: number, rot: number, radius = r) =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (i * 2 * Math.PI) / n;
      return [radius * Math.cos(a), radius * Math.sin(a)] as [number, number];
    });
  switch (shape) {
    case "circle":
      return `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
    case "square": {
      const s = r * 0.88;
      return poly([[-s, -s], [s, -s], [s, s], [-s, s]]);
    }
    case "triangle":
      return poly(ring(3, -Math.PI / 2, r * 1.15));
    case "triangle-down":
      return poly(ring(3, Math.PI / 2, r * 1.15));
    case "diamond":
      return poly(ring(4, -Math.PI / 2, r * 1.2));
    case "hexagon":
      return poly(ring(6, 0, r * 1.05));
    case "cross": {
      const a = r * 1.1;
      const b = r * 0.38;
      return poly([[-b, -a], [b, -a], [b, -b], [a, -b], [a, b], [b, b], [b, a], [-b, a], [-b, b], [-a, b], [-a, -b], [-b, -b]]);
    }
    case "star": {
      const outer = ring(5, -Math.PI / 2, r * 1.25);
      const inner = ring(5, -Math.PI / 2 + Math.PI / 5, r * 0.55);
      return poly(outer.flatMap((p, i) => [p, inner[i]]));
    }
  }
}

interface MarkerProps {
  shape: ShapeName;
  x?: number;
  y?: number;
  r: number;
  fill: string;
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
}

export function Marker({ shape, x = 0, y = 0, r, fill, opacity = 1, stroke, strokeWidth }: MarkerProps) {
  return (
    <path
      d={shapePath(shape, r)}
      transform={`translate(${x},${y})`}
      fill={fill}
      fillOpacity={opacity}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
  );
}

/** Legend swatch: the class's marker in a tiny inline SVG. */
export function ClassSwatch({ k, hollow = false }: { k: number; hollow?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true" className="shrink-0">
      <Marker
        shape={classShape(k)}
        r={4.5}
        fill={hollow ? "none" : classColor(k)}
        stroke={hollow ? classColor(k) : undefined}
        strokeWidth={hollow ? 1.5 : undefined}
      />
    </svg>
  );
}
