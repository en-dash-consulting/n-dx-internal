/**
 * Sparkline — Minimal inline SVG trend chart for zone metrics.
 *
 * Renders a small polyline chart with optional fill gradient,
 * suitable for embedding in zone cards and table rows.
 */

import { h } from "preact";

export interface SparklinePoint {
  value: number;
  label?: string;
}

export interface SparklineProps {
  /** Data points (ordered oldest → newest). */
  points: SparklinePoint[];
  /** SVG width in px (default 80). */
  width?: number;
  /** SVG height in px (default 24). */
  height?: number;
  /** Stroke color (default "var(--accent)"). */
  color?: string;
  /** Whether to show a gradient fill below the line. */
  fill?: boolean;
  /** Minimum Y domain value (default auto from data). */
  minY?: number;
  /** Maximum Y domain value (default auto from data). */
  maxY?: number;
}

export function Sparkline({
  points,
  width = 80,
  height = 24,
  color = "var(--accent)",
  fill = true,
  minY,
  maxY,
}: SparklineProps) {
  if (points.length < 2) return null;

  const values = points.map((p) => p.value);
  const dataMin = minY ?? Math.min(...values);
  const dataMax = maxY ?? Math.max(...values);
  const range = dataMax - dataMin || 1;

  const padX = 1;
  const padY = 2;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const coords = points.map((p, i) => {
    const x = padX + (i / (points.length - 1)) * plotW;
    const y = padY + plotH - ((p.value - dataMin) / range) * plotH;
    return { x, y };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");

  const fillPath = fill
    ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height} L ${coords[0].x.toFixed(1)} ${height} Z`
    : "";

  // Unique ID for gradient (avoid collisions with multiple instances)
  const gradId = `spark-grad-${Math.random().toString(36).slice(2, 8)}`;

  return h("svg", {
    class: "sparkline",
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": `Trend: ${values[values.length - 1]?.toFixed(2) ?? ""}`,
  },
    fill
      ? h("defs", null,
          h("linearGradient", { id: gradId, x1: "0", y1: "0", x2: "0", y2: "1" },
            h("stop", { offset: "0%", "stop-color": color, "stop-opacity": "0.25" }),
            h("stop", { offset: "100%", "stop-color": color, "stop-opacity": "0.02" }),
          ),
        )
      : null,
    fill && fillPath
      ? h("path", {
          d: fillPath,
          fill: `url(#${gradId})`,
        })
      : null,
    h("path", {
      d: linePath,
      fill: "none",
      stroke: color,
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
    // End dot
    h("circle", {
      cx: coords[coords.length - 1].x,
      cy: coords[coords.length - 1].y,
      r: 2,
      fill: color,
    }),
  );
}

// ── Dual-Metric Sparkline ────────────────────────────────────────────

export interface DualSparklineProps {
  /** Cohesion points (0–1, higher is better). */
  cohesionPoints: SparklinePoint[];
  /** Coupling points (0–1, lower is better). */
  couplingPoints: SparklinePoint[];
  /** Trend direction indicator. */
  trend: "improving" | "degrading" | "stable" | "insufficient";
  /** SVG width (default 100). */
  width?: number;
  /** SVG height (default 28). */
  height?: number;
  /** Click handler to expand full chart. */
  onClick?: () => void;
}

/**
 * Renders cohesion and coupling sparklines side-by-side with a trend indicator.
 */
export function DualSparkline({
  cohesionPoints,
  couplingPoints,
  trend,
  width = 100,
  height = 28,
  onClick,
}: DualSparklineProps) {
  if (cohesionPoints.length < 2 && couplingPoints.length < 2) {
    return h("div", {
      class: "zone-trend-placeholder",
      title: "Not enough history data",
    }, "—");
  }

  const trendIcon = trend === "improving" ? "↗" : trend === "degrading" ? "↘" : trend === "stable" ? "→" : "";
  const trendColor = trend === "improving" ? "var(--green)"
    : trend === "degrading" ? "var(--red)"
    : trend === "stable" ? "var(--text-dim)"
    : "var(--text-dim)";

  return h("div", {
    class: `zone-trend-spark ${onClick ? "clickable" : ""}`,
    onClick,
    title: onClick ? "Click to view full trend chart" : `Trend: ${trend}`,
    role: onClick ? "button" : undefined,
    tabIndex: onClick ? 0 : undefined,
  },
    h("div", { class: "zone-trend-spark-charts" },
      cohesionPoints.length >= 2
        ? h(Sparkline, {
            points: cohesionPoints,
            width: width / 2 - 2,
            height,
            color: "var(--green)",
            minY: 0,
            maxY: 1,
          })
        : null,
      couplingPoints.length >= 2
        ? h(Sparkline, {
            points: couplingPoints,
            width: width / 2 - 2,
            height,
            color: "var(--orange)",
            minY: 0,
            maxY: 1,
          })
        : null,
    ),
    trendIcon
      ? h("span", {
          class: "zone-trend-indicator",
          style: `color: ${trendColor}`,
        }, trendIcon)
      : null,
  );
}
