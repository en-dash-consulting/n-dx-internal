/**
 * Zone Trend Chart — Full-size overlay chart for zone metric history.
 *
 * Shows cohesion and coupling over time with labeled axes,
 * hover tooltips, and trend direction indicators.
 */

import { h, Fragment } from "preact";
import { useState, useMemo, useCallback, useEffect } from "preact/hooks";

export interface TrendPoint {
  timestamp: string;
  cohesion: number;
  coupling: number;
  riskScore: number;
  fileCount: number;
  gitSha?: string;
}

export interface ZoneTrendChartProps {
  zoneName: string;
  zoneColor: string;
  points: TrendPoint[];
  trend: "improving" | "degrading" | "stable" | "insufficient";
  onClose: () => void;
}

const CHART_W = 600;
const CHART_H = 260;
const PAD_LEFT = 48;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 40;

export function ZoneTrendChart({ zoneName, zoneColor, points, trend, onClose }: ZoneTrendChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const plotW = CHART_W - PAD_LEFT - PAD_RIGHT;
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;

  const toCoord = useCallback(
    (i: number, value: number) => ({
      x: PAD_LEFT + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2),
      y: PAD_TOP + plotH - value * plotH,
    }),
    [points.length, plotW, plotH],
  );

  const cohesionPath = useMemo(() => {
    return points
      .map((p, i) => {
        const { x, y } = toCoord(i, p.cohesion);
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }, [points, toCoord]);

  const couplingPath = useMemo(() => {
    return points
      .map((p, i) => {
        const { x, y } = toCoord(i, p.coupling);
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }, [points, toCoord]);

  const trendLabel = trend === "improving" ? "↗ Improving"
    : trend === "degrading" ? "↘ Degrading"
    : trend === "stable" ? "→ Stable"
    : "Insufficient data";

  const trendColor = trend === "improving" ? "var(--green)"
    : trend === "degrading" ? "var(--red)"
    : "var(--text-dim)";

  // Y-axis gridlines
  const gridLines = [0, 0.25, 0.5, 0.75, 1.0];

  // X-axis labels: show first, middle, and last timestamps
  const xLabels = useMemo(() => {
    if (points.length === 0) return [];
    const labels: { x: number; label: string }[] = [];
    const indices = points.length <= 3
      ? points.map((_, i) => i)
      : [0, Math.floor(points.length / 2), points.length - 1];
    for (const i of indices) {
      const { x } = toCoord(i, 0);
      labels.push({ x, label: formatTimestamp(points[i].timestamp) });
    }
    return labels;
  }, [points, toCoord]);

  const hovered = hoveredIdx !== null ? points[hoveredIdx] : null;

  return h(Fragment, null,
    // Backdrop
    h("div", {
      class: "zone-trend-backdrop",
      onClick: onClose,
    }),
    // Panel
    h("div", {
      class: "zone-trend-panel",
      role: "dialog",
      "aria-label": `Trend chart for ${zoneName}`,
    },
      // Header
      h("div", { class: "zone-trend-header" },
        h("div", { class: "zone-trend-title" },
          h("span", { class: "zone-trend-dot", style: `background: ${zoneColor}` }),
          h("h3", null, zoneName),
          h("span", { class: "zone-trend-label", style: `color: ${trendColor}` }, trendLabel),
        ),
        h("button", {
          class: "zone-trend-close",
          onClick: onClose,
          "aria-label": "Close trend chart",
        }, "\u2715"),
      ),

      // Legend
      h("div", { class: "zone-trend-legend" },
        h("span", { class: "zone-trend-legend-item" },
          h("span", { class: "zone-trend-legend-line", style: "background: var(--green)" }),
          "Cohesion (higher is better)",
        ),
        h("span", { class: "zone-trend-legend-item" },
          h("span", { class: "zone-trend-legend-line", style: "background: var(--orange)" }),
          "Coupling (lower is better)",
        ),
      ),

      // Chart
      h("svg", {
        viewBox: `0 0 ${CHART_W} ${CHART_H}`,
        class: "zone-trend-svg",
        preserveAspectRatio: "xMidYMid meet",
      },
        // Y-axis gridlines and labels
        ...gridLines.map((val) => {
          const y = PAD_TOP + plotH - val * plotH;
          return h("g", { key: `grid-${val}` },
            h("line", {
              x1: PAD_LEFT,
              y1: y,
              x2: PAD_LEFT + plotW,
              y2: y,
              stroke: "var(--border)",
              "stroke-width": 0.5,
              "stroke-dasharray": val === 0 || val === 1 ? "none" : "3,3",
            }),
            h("text", {
              x: PAD_LEFT - 8,
              y: y + 3,
              "text-anchor": "end",
              class: "zone-trend-axis-label",
            }, val.toFixed(2)),
          );
        }),

        // X-axis labels
        ...xLabels.map(({ x, label }) =>
          h("text", {
            key: `x-${label}`,
            x,
            y: CHART_H - 6,
            "text-anchor": "middle",
            class: "zone-trend-axis-label",
          }, label),
        ),

        // Cohesion line
        h("path", {
          d: cohesionPath,
          fill: "none",
          stroke: "var(--green)",
          "stroke-width": 2,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),

        // Coupling line
        h("path", {
          d: couplingPath,
          fill: "none",
          stroke: "var(--orange)",
          "stroke-width": 2,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),

        // Data point dots
        ...points.map((p, i) => {
          const cohCoord = toCoord(i, p.cohesion);
          const coupCoord = toCoord(i, p.coupling);
          return h("g", { key: `dots-${i}` },
            h("circle", {
              cx: cohCoord.x,
              cy: cohCoord.y,
              r: hoveredIdx === i ? 4 : 2.5,
              fill: "var(--green)",
            }),
            h("circle", {
              cx: coupCoord.x,
              cy: coupCoord.y,
              r: hoveredIdx === i ? 4 : 2.5,
              fill: "var(--orange)",
            }),
          );
        }),

        // Invisible hover targets
        ...points.map((_, i) => {
          const { x } = toCoord(i, 0.5);
          const hitW = plotW / Math.max(points.length - 1, 1);
          return h("rect", {
            key: `hit-${i}`,
            x: x - hitW / 2,
            y: PAD_TOP,
            width: hitW,
            height: plotH,
            fill: "transparent",
            onMouseEnter: () => setHoveredIdx(i),
            onMouseLeave: () => setHoveredIdx(null),
          });
        }),

        // Hover crosshair
        hoveredIdx !== null
          ? h("line", {
              x1: toCoord(hoveredIdx, 0).x,
              y1: PAD_TOP,
              x2: toCoord(hoveredIdx, 0).x,
              y2: PAD_TOP + plotH,
              stroke: "var(--text-dim)",
              "stroke-width": 0.5,
              "stroke-dasharray": "3,3",
              "pointer-events": "none",
            })
          : null,
      ),

      // Tooltip
      hovered
        ? h("div", { class: "zone-trend-tooltip" },
            h("div", { class: "zone-trend-tooltip-date" }, formatTimestamp(hovered.timestamp)),
            h("div", { class: "zone-trend-tooltip-row" },
              h("span", { style: "color: var(--green)" }, `Cohesion: ${hovered.cohesion.toFixed(3)}`),
            ),
            h("div", { class: "zone-trend-tooltip-row" },
              h("span", { style: "color: var(--orange)" }, `Coupling: ${hovered.coupling.toFixed(3)}`),
            ),
            h("div", { class: "zone-trend-tooltip-row" },
              h("span", { style: "color: var(--text-dim)" }, `Risk: ${hovered.riskScore.toFixed(3)}`),
            ),
            h("div", { class: "zone-trend-tooltip-row" },
              h("span", { style: "color: var(--text-dim)" }, `Files: ${hovered.fileCount}`),
            ),
            hovered.gitSha
              ? h("div", { class: "zone-trend-tooltip-row mono-sm" },
                  hovered.gitSha.slice(0, 8),
                )
              : null,
          )
        : null,
    ),
  );
}

/** Format an ISO timestamp to a short readable date. */
function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return ts.slice(0, 10);
  }
}
