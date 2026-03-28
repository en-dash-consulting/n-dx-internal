import { h } from "preact";
import { useMemo } from "preact/hooks";
import type { LoadedData, NavigateTo, DetailItem } from "../types.js";
import {
  BarChart,
  CollapsibleSection,
  HealthGauge,
  PatternBadge,
  MetricCard,
  getZoneColorByIndex,
} from "../visualization/index.js";
import { basename } from "../utils.js";
import { BrandedHeader } from "../components/logos.js";

interface OverviewProps {
  data: LoadedData;
  navigateTo?: NavigateTo;
  onSelect?: (detail: DetailItem | null) => void;
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f7df1e",
  CSS: "var(--purple)",
  HTML: "#e34f26",
  JSON: "#8b90a8",
  Markdown: "#8b90a8",
  SCSS: "#cc6699",
  Python: "#3776ab",
  Rust: "#dea584",
  Go: "#00add8",
};

const ROLE_COLORS: Record<string, string> = {
  source: "var(--accent)",
  test: "var(--green)",
  config: "var(--orange)",
  docs: "#8b90a8",
  generated: "var(--purple)",
  asset: "#fbbf24",
  build: "#dea584",
  other: "var(--text-dim)",
};

export function Overview({ data, navigateTo, onSelect }: OverviewProps) {
  const { manifest, inventory, imports, zones, components, callGraph, classifications } = data;

  if (!manifest && !inventory && !imports && !zones) {
    return h("div", { class: "loading" }, "No data loaded. Use 'sourcevision serve' or drop files.");
  }

  const hasZones = zones && zones.zones.length > 0;
  const hasImports = imports && imports.edges.length > 0;
  const showGettingStarted = manifest && (!hasImports || !hasZones);

  // Calculate overall health metrics
  const healthMetrics = useMemo(() => {
    if (!zones) return null;

    const avgCohesion = zones.zones.length > 0
      ? zones.zones.reduce((s, z) => s + z.cohesion, 0) / zones.zones.length
      : 0;

    const avgCoupling = zones.zones.length > 0
      ? zones.zones.reduce((s, z) => s + z.coupling, 0) / zones.zones.length
      : 0;

    // Count patterns and antipatterns from findings
    const patterns: string[] = [];
    const antipatterns: string[] = [];

    // High cohesion zones
    const highCohesionZones = zones.zones.filter(z => z.cohesion >= 0.8);
    if (highCohesionZones.length > zones.zones.length / 2) {
      patterns.push("Well-structured modules");
    }

    // Low coupling zones
    const lowCouplingZones = zones.zones.filter(z => z.coupling <= 0.3);
    if (lowCouplingZones.length > zones.zones.length / 2) {
      patterns.push("Clean boundaries");
    }

    // Check for circular deps
    if (imports && imports.summary.circularCount > 0) {
      antipatterns.push(`${imports.summary.circularCount} circular deps`);
    }

    // Hub files (too many importers)
    if (imports && imports.summary.mostImported.length > 0) {
      const hubs = imports.summary.mostImported.filter(f => f.count > 10);
      if (hubs.length > 0) {
        antipatterns.push(`${hubs.length} hub file${hubs.length > 1 ? "s" : ""}`);
      }
    }

    // Bidirectional coupling from findings
    const bidirectionalFindings = (zones.findings ?? []).filter(
      f => f.text.includes("Bidirectional")
    );
    if (bidirectionalFindings.length > 0) {
      antipatterns.push(`${bidirectionalFindings.length} bidirectional couplings`);
    }

    return { avgCohesion, avgCoupling, patterns, antipatterns };
  }, [zones, imports]);

  // Top zones by size
  const topZones = useMemo(() => {
    if (!zones) return [];
    return [...zones.zones]
      .sort((a, b) => b.files.length - a.files.length)
      .slice(0, 5);
  }, [zones]);

  // Language breakdown
  const langChartData = useMemo(() => {
    if (!inventory) return [];
    return Object.entries(inventory.summary.byLanguage)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([lang, count]) => ({
        label: lang,
        value: count,
        color: LANG_COLORS[lang] || "var(--accent)",
      }));
  }, [inventory]);

  // Zones needing attention count
  const attentionCount = useMemo(() => {
    if (!zones) return 0;
    return zones.zones.filter(z => z.cohesion < 0.4 || z.coupling > 0.5).length;
  }, [zones]);

  // Hotspot data: filter out external entries, take top 10
  const mostCalledItems = useMemo(() => {
    if (!callGraph) return [];
    return callGraph.summary.mostCalled
      .filter(f => f.file !== "<external>")
      .slice(0, 10);
  }, [callGraph]);

  const mostCallingItems = useMemo(() => {
    if (!callGraph) return [];
    return callGraph.summary.mostCalling
      .filter(f => f.file !== "<external>")
      .slice(0, 10);
  }, [callGraph]);

  const mostUsedComponents = useMemo(() => {
    if (!components) return [];
    return components.summary.mostUsedComponents.slice(0, 10);
  }, [components]);

  // Archetype distribution chart data
  const archetypeChartData = useMemo(() => {
    if (!classifications) return [];
    return Object.entries(classifications.summary.byArchetype)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([archetype, count]) => ({
        label: archetype,
        value: count,
        color: "var(--accent)",
      }));
  }, [classifications]);

  // byRole distribution chart data
  const roleChartData = useMemo(() => {
    if (!inventory || !inventory.summary.byRole) return [];
    return Object.entries(inventory.summary.byRole)
      .filter(([, count]) => (count as number) > 0)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([role, count]) => ({
        label: role,
        value: count as number,
        color: ROLE_COLORS[role] || "var(--text-dim)",
      }));
  }, [inventory]);

  // byCategory distribution chart data
  const categoryChartData = useMemo(() => {
    if (!inventory || !inventory.summary.byCategory) return [];
    return Object.entries(inventory.summary.byCategory)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 10)
      .map(([cat, count]) => ({
        label: cat,
        value: count as number,
        color: "var(--purple)",
      }));
  }, [inventory]);

  const hasHotspots = mostCalledItems.length > 0 || mostCallingItems.length > 0 || mostUsedComponents.length > 0;

  return h("div", { class: "overview-container" },
    // Header with project info
    manifest
      ? h("div", { class: "overview-header view-header" },
          h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
          h("h2", { class: "view-title" }, basename(manifest.targetPath)),
          h("p", { class: "overview-meta" },
            manifest.gitBranch ? `${manifest.gitBranch} ` : "",
            manifest.gitSha ? `(${manifest.gitSha.slice(0, 7)}) \u2022 ` : "",
            new Date(manifest.analyzedAt).toLocaleString()
          )
        )
      : h("div", { class: "view-header" },
          h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
          h("h2", { class: "view-title" }, "Overview"),
        ),

    // Getting Started guide for incomplete analysis
    showGettingStarted
      ? h("div", { class: "getting-started" },
          h("h3", null, "Getting Started"),
          h("p", null, "Complete the analysis to see architectural insights:"),
          h("ol", null,
            !hasImports
              ? h("li", null, h("code", null, "sourcevision analyze --phase=2"), " \u2014 Build import graph")
              : null,
            !hasZones
              ? h("li", null, h("code", null, "sourcevision analyze --phase=3"), " \u2014 Detect zones")
              : null,
            h("li", null, h("code", null, "sourcevision analyze --full"), " \u2014 Run full analysis"),
          ),
        )
      : null,

    // Main metrics row
    h("div", { class: "overview-metrics" },
      inventory
        ? h(MetricCard, {
            value: inventory.summary.totalFiles,
            label: "Files",
          })
        : null,
      inventory
        ? h(MetricCard, {
            value: Math.round(inventory.summary.totalLines / 1000) + "k",
            label: "Lines of Code",
          })
        : null,
      zones
        ? h(MetricCard, {
            value: zones.zones.length,
            label: "Zones",
            color: "var(--accent)",
          })
        : null,
      imports
        ? h(MetricCard, {
            value: imports.summary.circularCount,
            label: "Circular Deps",
            color: imports.summary.circularCount > 0 ? "var(--orange)" : "var(--green)",
          })
        : null,
      components && components.summary.totalServerRoutes && components.summary.totalServerRoutes > 0
        ? h(MetricCard, {
            value: components.summary.totalServerRoutes,
            label: "Server Endpoints",
            color: "var(--accent)",
          })
        : null,
      imports && imports.summary.avgImportsPerFile > 0
        ? h(MetricCard, {
            value: imports.summary.avgImportsPerFile,
            label: "Avg Imports/File",
          })
        : null,
      imports && imports.summary.totalExternal > 0
        ? h(MetricCard, {
            value: imports.summary.totalExternal,
            label: "External Deps",
          })
        : null,
      callGraph
        ? h(MetricCard, {
            value: callGraph.summary.totalFunctions.toLocaleString(),
            label: "Functions",
            color: "var(--accent)",
          })
        : null,
      callGraph
        ? h(MetricCard, {
            value: callGraph.summary.totalCalls.toLocaleString(),
            label: "Call Edges",
          })
        : null,
      callGraph
        ? h(MetricCard, {
            value: callGraph.summary.cycleCount,
            label: "Call Cycles",
            color: callGraph.summary.cycleCount > 0 ? "var(--purple)" : "var(--green)",
          })
        : null,
      classifications
        ? h(MetricCard, {
            value: classifications.summary.totalClassified,
            label: "Classified",
            color: "var(--accent)",
          })
        : null,
      classifications && classifications.summary.totalUnclassified > 0
        ? h(MetricCard, {
            value: classifications.summary.totalUnclassified,
            label: "Unclassified",
            color: "var(--orange)",
          })
        : null,
    ),

    // Architecture health section
    healthMetrics && zones
      ? h("div", { class: "overview-section" },
          h("div", { class: "section-header-row" },
            h("h3", null, "Architecture Health"),
            zones.enrichmentPass
              ? h("span", { class: "enrichment-badge" },
                  `Pass ${zones.enrichmentPass}${zones.metaEvaluationCount ? ` + ${zones.metaEvaluationCount} meta` : ""}`
                )
              : null,
            zones.lastReset
              ? h("span", { class: "enrichment-badge reset-badge" },
                  `Reset from Pass ${zones.lastReset.from} → ${zones.lastReset.to}`
                )
              : null
          ),

          h("div", { class: "health-row" },
            h(HealthGauge, {
              value: healthMetrics.avgCohesion,
              label: "Avg Cohesion",
              size: 90,
            }),
            h(HealthGauge, {
              value: healthMetrics.avgCoupling,
              label: "Avg Coupling",
              size: 90,
              inverted: true,
            }),
            h("div", { class: "pattern-list" },
              healthMetrics.patterns.map(p =>
                h(PatternBadge, { key: p, type: "pattern", label: p })
              ),
              healthMetrics.antipatterns.map(p =>
                h(PatternBadge, { key: p, type: "antipattern", label: p })
              )
            )
          )
        )
      : null,

    // Two-column layout: Languages + Zone summary
    h("div", { class: "overview-columns" },
      // Left column - Languages
      langChartData.length > 0
        ? h("div", { class: "overview-col" },
            h("h3", null, "Languages"),
            h(BarChart, { data: langChartData })
          )
        : null,

      // Right column - Compact zone summary
      topZones.length > 0
        ? h("div", { class: "overview-col" },
            h("div", { class: "section-header-row" },
              h("h3", null, "Top Zones"),
              navigateTo
                ? h("button", {
                    class: "link-btn",
                    onClick: () => navigateTo("zones"),
                  }, "View all \u2192")
                : null
            ),
            h("div", { class: "top-zones-list" },
              topZones.map((zone, i) => {
                const globalIdx = zones!.zones.indexOf(zone);
                const color = getZoneColorByIndex(globalIdx);
                const healthColor = zone.cohesion >= 0.7 ? "var(--green)"
                  : zone.cohesion >= 0.4 ? "var(--orange)"
                  : "var(--red)";

                return h("div", {
                  key: zone.id,
                  class: "top-zone-item",
                  onClick: navigateTo ? () => navigateTo("zones", { zone: zone.id }) : undefined,
                },
                  h("span", { class: "zone-dot", style: `background: ${color}` }),
                  h("span", { class: "zone-name" }, zone.name),
                  h("span", { class: "zone-files" }, `${zone.files.length} files`),
                  h("span", {
                    class: "health-dot",
                    style: `background: ${healthColor}`,
                    title: `Cohesion: ${zone.cohesion.toFixed(2)} / Coupling: ${zone.coupling.toFixed(2)}`,
                  })
                );
              })
            ),
            attentionCount > 0
              ? h("div", { class: "zone-attention-note" },
                  `${attentionCount} zone${attentionCount > 1 ? "s" : ""} need${attentionCount === 1 ? "s" : ""} attention`
                )
              : null
          )
        : null
    ),

    // byRole / byCategory distribution
    (roleChartData.length > 0 || categoryChartData.length > 0)
      ? h("div", { class: "overview-columns" },
          roleChartData.length > 0
            ? h("div", { class: "overview-col" },
                h("h3", null, "Files by Role"),
                h(BarChart, { data: roleChartData }),
              )
            : null,
          categoryChartData.length > 0
            ? h("div", { class: "overview-col" },
                h("h3", null, "Files by Category"),
                h(BarChart, { data: categoryChartData }),
              )
            : null,
        )
      : null,

    // Archetype distribution
    archetypeChartData.length > 0
      ? h("div", { class: "overview-section" },
          h("div", { class: "section-header-row" },
            h("h3", null, "File Archetypes"),
            navigateTo
              ? h("button", {
                  class: "link-btn",
                  onClick: () => navigateTo("files"),
                }, "View files \u2192")
              : null
          ),
          h(BarChart, { data: archetypeChartData })
        )
      : null,

    // Hotspots panel
    hasHotspots
      ? h("div", { class: "overview-section hotspots-panel" },
          h("h3", null, "Hotspots"),
          h("div", { class: "hotspots-grid" },
            mostCalledItems.length > 0
              ? h("div", { class: "hotspots-col" },
                  h(CollapsibleSection, {
                    title: "Most Called Functions",
                    count: mostCalledItems.length,
                    defaultOpen: true,
                    storageKey: "hotspots-most-called",
                  },
                    mostCalledItems.map((item, i) =>
                      h("div", {
                        key: `called-${i}`,
                        class: "hotspot-item",
                        onClick: navigateTo ? () => navigateTo("files", { file: item.file }) : undefined,
                        title: `${item.qualifiedName} in ${item.file}`,
                      },
                        h("span", { class: "hotspot-rank" }, `${i + 1}`),
                        h("span", { class: "hotspot-name" }, item.qualifiedName),
                        h("span", { class: "hotspot-count called" }, `${item.callerCount} callers`),
                        h("span", { class: "hotspot-file" }, item.file),
                      )
                    )
                  )
                )
              : null,
            mostCallingItems.length > 0
              ? h("div", { class: "hotspots-col" },
                  h(CollapsibleSection, {
                    title: "Most Calling Functions",
                    count: mostCallingItems.length,
                    defaultOpen: true,
                    storageKey: "hotspots-most-calling",
                  },
                    mostCallingItems.map((item, i) =>
                      h("div", {
                        key: `calling-${i}`,
                        class: "hotspot-item",
                        onClick: navigateTo ? () => navigateTo("files", { file: item.file }) : undefined,
                        title: `${item.qualifiedName} in ${item.file}`,
                      },
                        h("span", { class: "hotspot-rank" }, `${i + 1}`),
                        h("span", { class: "hotspot-name" }, item.qualifiedName),
                        h("span", { class: "hotspot-count calling" }, `${item.calleeCount} callees`),
                        h("span", { class: "hotspot-file" }, item.file),
                      )
                    )
                  )
                )
              : null,
            mostUsedComponents.length > 0
              ? h("div", { class: "hotspots-col" },
                  h(CollapsibleSection, {
                    title: "Most Used Components",
                    count: mostUsedComponents.length,
                    defaultOpen: true,
                    storageKey: "hotspots-most-used",
                  },
                    mostUsedComponents.map((item, i) =>
                      h("div", {
                        key: `comp-${i}`,
                        class: "hotspot-item",
                        onClick: navigateTo ? () => navigateTo("files", { file: item.file }) : undefined,
                        title: `${item.name} in ${item.file}`,
                      },
                        h("span", { class: "hotspot-rank" }, `${i + 1}`),
                        h("span", { class: "hotspot-name" }, item.name),
                        h("span", { class: "hotspot-count component" }, `${item.usageCount} uses`),
                        h("span", { class: "hotspot-file" }, item.file),
                      )
                    )
                  )
                )
              : null,
          )
        )
      : null,

    // Circular dependencies (compact, clickable to focus in graph)
    imports?.summary.circulars.length
      ? h("div", { class: "overview-section" },
          h("h3", null, `${imports.summary.circularCount} Circular Dep${imports.summary.circularCount > 1 ? "s" : ""}`),
          navigateTo
            ? h("p", { class: "section-sub", style: "margin-bottom: 8px;" }, "Click a cycle to highlight it in the import graph.")
            : null,
          h("div", { class: "circular-list" },
            imports.summary.circulars.slice(0, 3).map((c, i) =>
              h("div", {
                key: i,
                class: `circular-dep-block${navigateTo ? " clickable" : ""}`,
                onClick: navigateTo ? () => navigateTo("explorer", { cycle: c.cycle }) : undefined,
                title: navigateTo ? "Click to highlight in import graph" : undefined,
              },
                c.cycle.join(" \u2192 ") + " \u2192 " + c.cycle[0]
              )
            ),
            imports.summary.circulars.length > 3
              ? h("div", { class: "attention-more" },
                  `+${imports.summary.circulars.length - 3} more`
                )
              : null
          )
        )
      : null
  );
}
