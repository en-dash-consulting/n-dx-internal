import { h, Fragment } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import type { Zone, ZoneCrossing, RiskLevel } from "../external.js";
import { getZoneColorByIndex } from "../visualization/colors.js";
import { meterClass } from "../visualization/metrics.js";
import { DualSparkline } from "./data-display/sparkline.js";
import { basename } from "../utils.js";
import type { NavigateTo } from "../types.js";
import type { ZoneHistoryData } from "../hooks/use-zone-history.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface ZoneSlideoutProps {
  /** Zone to display, or null to hide the panel. */
  zone: Zone | null;
  /** All crossings for computing dependencies. */
  crossings: ZoneCrossing[];
  /** Full zone list for color lookup and dependency name resolution. */
  allZones: Zone[];
  /** Close the slideout. */
  onClose: () => void;
  /** Navigate to a file when clicked. */
  onFileClick?: (path: string) => void;
  /** Navigate to a different view. */
  navigateTo?: NavigateTo;
  /** Zone convergence history data (lazy-loaded). */
  zoneHistory?: ZoneHistoryData;
  /** Open the full trend chart for a zone. */
  onOpenTrendChart?: (zoneId: string) => void;
}

// ── Risk helpers ──────────────────────────────────────────────────────

const RISK_BADGE_CLASS: Record<RiskLevel, string> = {
  healthy: "risk-badge--healthy",
  "at-risk": "risk-badge--at-risk",
  critical: "risk-badge--critical",
  catastrophic: "risk-badge--catastrophic",
};

const DETECTION_QUALITY_TOOLTIP: Record<string, string> = {
  genuine: "Genuine architectural unit identified by community detection",
  artifact: "Detection artifact — residual community from Louvain when most files are pinned elsewhere",
  residual: "Residual zone — remaining files after primary zones were formed",
};

// ── Component ──────────────────────────────────────────────────────────

export function ZoneSlideout({
  zone,
  crossings,
  allZones,
  onClose,
  onFileClick,
  navigateTo,
  zoneHistory,
  onOpenTrendChart,
}: ZoneSlideoutProps) {
  const [showFiles, setShowFiles] = useState(false);
  const [contextMd, setContextMd] = useState<string | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [showContext, setShowContext] = useState(false);

  // Reset state when zone changes
  useEffect(() => {
    setShowFiles(false);
    setContextMd(null);
    setShowContext(false);
  }, [zone?.id]);

  // Load per-zone context.md on demand
  useEffect(() => {
    if (!zone || !showContext || contextMd !== null) return;
    setContextLoading(true);
    fetch(`/data/zones/${encodeURIComponent(zone.id)}/context.md`)
      .then((res) => {
        if (res.ok) return res.text();
        return null;
      })
      .then((text) => {
        setContextMd(text ?? "");
        setContextLoading(false);
      })
      .catch(() => {
        setContextMd("");
        setContextLoading(false);
      });
  }, [zone?.id, showContext, contextMd]);

  // Close on Escape
  useEffect(() => {
    if (!zone) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [zone, onClose]);

  // Trap focus inside the panel when open
  const panelRef = useCallback((el: HTMLElement | null) => {
    if (el) el.focus();
  }, []);

  if (!zone) return null;

  const zoneIdx = allZones.indexOf(zone);
  const color = getZoneColorByIndex(zoneIdx >= 0 ? zoneIdx : 0);
  const risk = zone.riskMetrics;
  const dq = zone.detectionQuality;

  // Dependencies
  const incoming = crossings.filter((c) => c.toZone === zone.id);
  const outgoing = crossings.filter((c) => c.fromZone === zone.id);
  const incomingByZone = groupBy(incoming, (c) => c.fromZone);
  const outgoingByZone = groupBy(outgoing, (c) => c.toZone);

  return h(Fragment, null,
    // Backdrop — click to dismiss
    h("div", {
      class: "zone-slideout-backdrop open",
      onClick: onClose,
      "aria-hidden": "true",
    }),
    // Panel
    h("aside", {
      ref: panelRef,
      class: "zone-slideout open",
      role: "complementary",
      "aria-label": `Zone details: ${zone.name}`,
      tabIndex: -1,
      style: `--zone-accent: ${color}`,
    },
      // Header
      h("div", { class: "zone-slideout-header" },
        h("div", { class: "zone-slideout-title" },
          h("span", { class: "zone-slideout-dot", style: `background: ${color}` }),
          h("h3", null, zone.name),
        ),
        h("button", {
          class: "zone-slideout-close",
          onClick: onClose,
          "aria-label": "Close zone details",
          title: "Close (Esc)",
        }, "\u2715"),
      ),

      // Risk level badge + detection quality + policy-fail
      (risk || dq)
        ? h("div", { class: "zone-slideout-badges" },
            risk
              ? h("span", {
                  class: `risk-badge ${RISK_BADGE_CLASS[risk.riskLevel]}`,
                  title: `Risk score: ${risk.riskScore.toFixed(2)}`,
                }, risk.riskLevel)
              : null,
            risk?.failsThreshold
              ? h("span", {
                  class: "risk-badge risk-badge--policy-fail",
                  title: "Fails dual-fragility threshold: cohesion < 0.4 AND coupling > 0.6",
                }, "\u26A0 policy fail")
              : null,
            dq
              ? h("span", {
                  class: `detection-quality-badge detection-quality--${dq}`,
                  title: DETECTION_QUALITY_TOOLTIP[dq] || dq,
                }, dq)
              : null,
          )
        : null,

      // Description
      zone.description
        ? h("p", { class: "zone-slideout-desc" }, zone.description)
        : null,

      // Risk justification (when present)
      risk?.riskJustification
        ? h("div", { class: "zone-slideout-justification" },
            h("span", { class: "zone-slideout-justification-label" }, "Risk Justification"),
            h("p", { class: "zone-slideout-justification-text" }, risk.riskJustification),
          )
        : null,

      // Metrics row
      h("div", { class: "zone-slideout-metrics" },
        h("div", { class: "zone-slideout-metric" },
          h("span", { class: "zone-slideout-metric-val" }, zone.files.length),
          h("span", { class: "zone-slideout-metric-lbl" }, "files"),
        ),
        h("div", { class: "zone-slideout-metric" },
          h("span", {
            class: "zone-slideout-metric-val",
            style: `color: ${cohesionColor(zone.cohesion)}`,
          }, zone.cohesion.toFixed(2)),
          h("span", { class: "zone-slideout-metric-lbl" }, "cohesion"),
        ),
        h("div", { class: "zone-slideout-metric" },
          h("span", {
            class: "zone-slideout-metric-val",
            style: `color: ${couplingColor(zone.coupling)}`,
          }, zone.coupling.toFixed(2)),
          h("span", { class: "zone-slideout-metric-lbl" }, "coupling"),
        ),
      ),

      // Cohesion meter
      h("div", { class: "zone-slideout-meter-row" },
        h("span", { class: "zone-slideout-meter-label" }, "Cohesion"),
        h("div", { class: "meter" },
          h("div", {
            class: `meter-fill ${meterClass(zone.cohesion)}`,
            style: `width: ${zone.cohesion * 100}%`,
          }),
        ),
      ),

      // Coupling meter
      h("div", { class: "zone-slideout-meter-row" },
        h("span", { class: "zone-slideout-meter-label" }, "Coupling"),
        h("div", { class: "meter" },
          h("div", {
            class: `meter-fill ${meterClass(zone.coupling, true)}`,
            style: `width: ${zone.coupling * 100}%`,
          }),
        ),
      ),

      // Convergence trend sparkline
      renderTrendSection(zone.id, zoneHistory, onOpenTrendChart),

      // Entry points
      zone.entryPoints.length > 0
        ? h("div", { class: "zone-slideout-section" },
            h("h4", null, "Entry Points"),
            h("ul", { class: "zone-slideout-list" },
              zone.entryPoints.slice(0, 8).map((ep) =>
                h("li", {
                  key: ep,
                  class: `zone-slideout-list-item mono-sm ${onFileClick ? "clickable" : ""}`,
                  title: ep,
                  onClick: onFileClick ? () => onFileClick(ep) : undefined,
                }, basename(ep)),
              ),
              zone.entryPoints.length > 8
                ? h("li", { class: "zone-slideout-list-more" },
                    `+${zone.entryPoints.length - 8} more`,
                  )
                : null,
            ),
          )
        : null,

      // Insights
      zone.insights && zone.insights.length > 0
        ? h("div", { class: "zone-slideout-section" },
            h("h4", null, "Insights"),
            h("ul", { class: "zone-slideout-list" },
              zone.insights.slice(0, 6).map((ins, i) =>
                h("li", { key: i, class: "zone-slideout-list-item" }, ins),
              ),
              zone.insights.length > 6
                ? h("li", { class: "zone-slideout-list-more" },
                    `+${zone.insights.length - 6} more`,
                  )
                : null,
            ),
          )
        : null,

      // Sub-zones
      zone.subZones && zone.subZones.length > 0
        ? h("div", { class: "zone-slideout-section" },
            h("h4", null, "Sub-zones"),
            h("ul", { class: "zone-slideout-list" },
              zone.subZones.slice(0, 6).map((sz) =>
                h("li", { key: sz.id, class: "zone-slideout-dep-item" },
                  h("span", null, sz.name),
                  h("span", { class: "zone-slideout-dep-count" }, `${sz.files.length} files`),
                ),
              ),
              zone.subZones.length > 6
                ? h("li", { class: "zone-slideout-list-more" },
                    `+${zone.subZones.length - 6} more`,
                  )
                : null,
            ),
          )
        : null,

      // Dependencies
      (Object.keys(incomingByZone).length > 0 || Object.keys(outgoingByZone).length > 0)
        ? h("div", { class: "zone-slideout-section" },
            h("h4", null, "Dependencies"),
            h("div", { class: "zone-slideout-deps" },
              Object.keys(outgoingByZone).length > 0
                ? h("div", { class: "zone-slideout-dep-col" },
                    h("span", { class: "zone-slideout-dep-label" }, "Depends on"),
                    ...Object.entries(outgoingByZone).slice(0, 6).map(([zoneId, items]) => {
                      const target = allZones.find((z) => z.id === zoneId);
                      return h("div", { key: zoneId, class: "zone-slideout-dep-item" },
                        h("span", null, target?.name || zoneId),
                        h("span", { class: "zone-slideout-dep-count" }, items.length),
                      );
                    }),
                  )
                : null,
              Object.keys(incomingByZone).length > 0
                ? h("div", { class: "zone-slideout-dep-col" },
                    h("span", { class: "zone-slideout-dep-label" }, "Used by"),
                    ...Object.entries(incomingByZone).slice(0, 6).map(([zoneId, items]) => {
                      const source = allZones.find((z) => z.id === zoneId);
                      return h("div", { key: zoneId, class: "zone-slideout-dep-item" },
                        h("span", null, source?.name || zoneId),
                        h("span", { class: "zone-slideout-dep-count" }, items.length),
                      );
                    }),
                  )
                : null,
            ),
          )
        : null,

      // Files toggle
      h("div", { class: "zone-slideout-section" },
        h("button", {
          class: "zone-slideout-files-toggle",
          onClick: () => setShowFiles(!showFiles),
        },
          showFiles ? "Hide files" : `Show ${zone.files.length} files`,
        ),
        showFiles
          ? h("ul", { class: "zone-slideout-file-list" },
              zone.files.map((f) =>
                h("li", {
                  key: f,
                  class: `zone-slideout-file-item mono-sm ${onFileClick ? "clickable" : ""}`,
                  onClick: onFileClick ? () => onFileClick(f) : undefined,
                },
                  h("span", { class: "zone-slideout-file-path" }, f),
                  zone.entryPoints.includes(f)
                    ? h("span", { class: "zone-slideout-entry-badge" }, "entry")
                    : null,
                ),
              ),
            )
          : null,
      ),

      // Zone AI context toggle
      h("div", { class: "zone-slideout-section" },
        h("button", {
          class: "zone-slideout-files-toggle",
          onClick: () => setShowContext(!showContext),
        },
          showContext ? "Hide AI context" : "Show AI context",
        ),
        showContext
          ? contextLoading
            ? h("div", { class: "zone-slideout-context-loading" }, "Loading context\u2026")
            : contextMd
              ? h("pre", { class: "zone-slideout-context-md" }, contextMd)
              : h("div", { class: "zone-slideout-context-empty" }, "No per-zone context available.")
          : null,
      ),

      // Navigation buttons
      navigateTo
        ? h("div", { class: "zone-slideout-nav" },
            h("button", {
              class: "zone-slideout-nav-btn",
              onClick: () => navigateTo("files", { zone: zone.id }),
            }, "\u2630 View in Files"),
            h("button", {
              class: "zone-slideout-nav-btn",
              onClick: () => navigateTo("problems"),
            }, "\u26A0 View Problems"),
            h("button", {
              class: "zone-slideout-nav-btn",
              onClick: () => navigateTo("suggestions"),
            }, "\u2728 View Suggestions"),
          )
        : null,
    ),
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function cohesionColor(v: number): string {
  return v >= 0.7 ? "var(--green)" : v >= 0.4 ? "var(--orange)" : "var(--red)";
}

function couplingColor(v: number): string {
  return v <= 0.3 ? "var(--green)" : v <= 0.5 ? "var(--orange)" : "var(--red)";
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    if (!result[k]) result[k] = [];
    result[k].push(item);
  }
  return result;
}

/**
 * Render the convergence trend section in the zone slideout.
 * Shows a sparkline with cohesion/coupling history, or a placeholder
 * when data is unavailable or insufficient.
 */
function renderTrendSection(
  zoneId: string,
  zoneHistory: ZoneHistoryData | undefined,
  onOpenTrendChart: ((zoneId: string) => void) | undefined,
) {
  // History not loaded yet
  if (!zoneHistory) {
    return h("div", { class: "zone-slideout-trend-section" },
      h("div", { class: "zone-slideout-trend-header" },
        h("h4", null, "Trend"),
      ),
      h("div", { class: "zone-slideout-trend-loading" }, "Loading history\u2026"),
    );
  }

  const series = zoneHistory.zones.find((z) => z.zoneId === zoneId);

  // No history for this zone
  if (!series || series.points.length === 0) {
    return h("div", { class: "zone-slideout-trend-section" },
      h("div", { class: "zone-slideout-trend-header" },
        h("h4", null, "Trend"),
      ),
      h("div", { class: "zone-slideout-trend-empty" }, "No history available"),
    );
  }

  // Not enough data points for a trend line
  if (series.points.length < 2) {
    return h("div", { class: "zone-slideout-trend-section" },
      h("div", { class: "zone-slideout-trend-header" },
        h("h4", null, "Trend"),
      ),
      h("div", { class: "zone-slideout-trend-empty" }, "Not enough history"),
    );
  }

  const trendIcon = series.trend === "improving" ? "\u2197"
    : series.trend === "degrading" ? "\u2198"
    : series.trend === "stable" ? "\u2192"
    : "";
  const trendColor = series.trend === "improving" ? "var(--green)"
    : series.trend === "degrading" ? "var(--red)"
    : "var(--text-dim)";

  const cohesionPoints = series.points.map((p) => ({ value: p.cohesion }));
  const couplingPoints = series.points.map((p) => ({ value: p.coupling }));

  return h("div", { class: "zone-slideout-trend-section" },
    h("div", { class: "zone-slideout-trend-header" },
      h("h4", null, "Trend"),
      h("span", {
        class: "zone-trend-indicator",
        style: `color: ${trendColor}`,
        title: `${series.trend} (${series.points.length} snapshots)`,
      }, trendIcon),
    ),
    h(DualSparkline, {
      cohesionPoints,
      couplingPoints,
      trend: series.trend,
      width: 140,
      height: 32,
      onClick: onOpenTrendChart ? () => onOpenTrendChart(zoneId) : undefined,
    }),
    h("div", {
      style: "display: flex; gap: 12px; font-size: 10px; color: var(--text-dim); margin-top: 2px;",
    },
      h("span", null, `\u25CF Cohesion`),
      h("span", { style: "color: var(--orange)" }, `\u25CF Coupling`),
      h("span", null, `${series.points.length} snapshots`),
    ),
  );
}
