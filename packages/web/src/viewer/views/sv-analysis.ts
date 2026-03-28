/**
 * Unified Analysis view — consolidates Architecture, Problems, and Suggestions.
 *
 * Merges all findings (patterns, relationships, anti-patterns, suggestions,
 * move-file recommendations) into a single view with type-based sections,
 * severity filtering, and softened enrichment gating. Preserves all data
 * visualizations from the former Architecture view (external deps, hub files,
 * database layer, package dependencies).
 */
import { h, Fragment } from "preact";
import { useState, useMemo } from "preact/hooks";
import type { LoadedData, NavigateTo, DetailItem } from "../types.js";
import type { Finding, FindingType, ExternalImport } from "../external.js";
import { FindingsList, BarChart, FlowDiagram, CollapsibleSection } from "../visualization/index.js";
import { BrandedHeader } from "../components/logos.js";
import { detectDatabasePackages, classifyDbPackage, DB_CATEGORY_LABELS, DB_CATEGORY_TAG_CLASS } from "./db-packages.js";
import type { DbCategory, DbPackageMatch } from "./db-packages.js";

// ── Types ───────────────────────────────────────────────────────────

type FindingCategory = "architecture" | "problems" | "suggestions" | "move-file";
type SeverityFilter = "all" | "critical" | "warning" | "info";

const CATEGORY_META: Record<FindingCategory, { label: string; icon: string; types: FindingType[]; minPass: number }> = {
  architecture: { label: "Architecture", icon: "\u25E8", types: ["pattern", "relationship"], minPass: 2 },
  problems:     { label: "Problems",     icon: "\u26A0", types: ["anti-pattern"],             minPass: 3 },
  suggestions:  { label: "Suggestions",  icon: "\u2728", types: ["suggestion"],               minPass: 4 },
  "move-file":  { label: "Move File",    icon: "\u21E5", types: ["move-file"],                minPass: 2 },
};

const CATEGORY_ORDER: FindingCategory[] = ["architecture", "problems", "suggestions", "move-file"];

interface SvAnalysisProps {
  data: LoadedData;
  onSelect: (detail: DetailItem | null) => void;
  navigateTo?: NavigateTo;
}

export function SvAnalysisView({ data, onSelect, navigateTo }: SvAnalysisProps) {
  const { zones, imports } = data;
  const enrichmentPass = zones?.enrichmentPass ?? 0;

  // ── State ───────────────────────────────────────────────────────
  const [activeCategory, setActiveCategory] = useState<FindingCategory | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");

  // ── All findings from zones.json ────────────────────────────────
  const allFindings = zones?.findings ?? [];

  // ── Categorized findings ────────────────────────────────────────
  const categorized = useMemo(() => {
    const result: Record<FindingCategory, Finding[]> = {
      architecture: [],
      problems: [],
      suggestions: [],
      "move-file": [],
    };
    for (const f of allFindings) {
      for (const cat of CATEGORY_ORDER) {
        if (CATEGORY_META[cat].types.includes(f.type)) {
          result[cat].push(f);
          break;
        }
      }
    }
    return result;
  }, [allFindings]);

  // ── Severity filter application ─────────────────────────────────
  const filterBySeverity = (findings: Finding[]): Finding[] => {
    if (severityFilter === "all") return findings;
    return findings.filter((f) => (f.severity || "info") === severityFilter);
  };

  // ── Visible findings based on category + severity filters ───────
  const visibleFindings = useMemo(() => {
    if (activeCategory === "all") {
      return filterBySeverity(allFindings);
    }
    return filterBySeverity(categorized[activeCategory]);
  }, [allFindings, categorized, activeCategory, severityFilter]);

  // ── Legacy insights fallback ────────────────────────────────────
  const legacyInsights = allFindings.length === 0 ? (zones?.insights ?? []) : [];

  // ── Severity counts (across active category's findings) ─────────
  const severityCounts = useMemo(() => {
    const counts = { critical: 0, warning: 0, info: 0 };
    const source = activeCategory === "all" ? allFindings : categorized[activeCategory];
    for (const f of source) {
      const sev = f.severity || "info";
      if (sev in counts) counts[sev as keyof typeof counts]++;
    }
    return counts;
  }, [allFindings, categorized, activeCategory]);

  // ── Enrichment notices ──────────────────────────────────────────
  const pendingCategories = useMemo(() => {
    return CATEGORY_ORDER.filter((cat) =>
      enrichmentPass < CATEGORY_META[cat].minPass
    );
  }, [enrichmentPass]);

  // ── Zone health overview (from Architecture) ────────────────────
  const zoneHealthData = useMemo(() => {
    if (!zones) return [];
    return zones.zones.map((z) => ({
      label: z.name,
      value: z.files.length,
      color: z.cohesion >= 0.6 ? "var(--green)" : z.cohesion >= 0.4 ? "var(--orange)" : "var(--red)",
    }));
  }, [zones]);

  // Cross-zone traffic summary
  const crossingCount = zones?.crossings?.length ?? 0;
  const archFindings = categorized.architecture;
  const biDirectional = archFindings.filter((f) => /bidirectional/i.test(f.text)).length;

  // Hub files: most imported files across the codebase
  const hubFilesData = useMemo(() => {
    if (!imports) return [];
    const hubs = imports.summary.mostImported.filter((f) => f.count > 3);
    if (hubs.length === 0) return [];
    return hubs
      .slice(0, 15)
      .map((f) => ({
        label: shortFilePath(f.path),
        value: f.count,
        color: f.count > 10 ? "var(--red)" : f.count > 5 ? "var(--orange)" : "var(--green)",
      }));
  }, [imports]);

  // ── External dependencies ───────────────────────────────────────
  const externalDepsData = useMemo(() => {
    if (!imports) return { hasKind: false, stdlib: [] as ExternalImport[], thirdParty: [] as ExternalImport[], all: [] as ExternalImport[] };
    const externals = imports.external;
    if (externals.length === 0) return { hasKind: false, stdlib: [] as ExternalImport[], thirdParty: [] as ExternalImport[], all: [] as ExternalImport[] };

    const stdlib: ExternalImport[] = [];
    const thirdParty: ExternalImport[] = [];

    for (const ext of externals) {
      const isStdlib = ext.kind === "stdlib" || (!ext.kind && ext.package.startsWith("stdlib:"));
      if (isStdlib) {
        stdlib.push(ext);
      } else {
        thirdParty.push(ext);
      }
    }

    const sortByUsage = (a: ExternalImport, b: ExternalImport) => b.importedBy.length - a.importedBy.length;
    stdlib.sort(sortByUsage);
    thirdParty.sort(sortByUsage);

    const all = [...externals].sort(sortByUsage);
    const hasKind = externals.some((e) => e.kind != null) || stdlib.length > 0;

    return { hasKind, stdlib, thirdParty, all };
  }, [imports]);

  const topDepsChartData = useMemo(() => {
    const source = externalDepsData.hasKind ? externalDepsData.thirdParty : externalDepsData.all;
    return source
      .slice(0, 15)
      .map((ext) => ({
        label: ext.package,
        value: ext.importedBy.length,
        color: ext.importedBy.length > 10 ? "var(--red)" : ext.importedBy.length > 5 ? "var(--orange)" : "var(--accent)",
      }));
  }, [externalDepsData]);

  const stdlibChartData = useMemo(() => {
    if (!externalDepsData.hasKind) return [];
    return externalDepsData.stdlib
      .slice(0, 15)
      .map((ext) => ({
        label: ext.package.replace(/^stdlib:/, ""),
        value: ext.importedBy.length,
        color: "var(--green)",
      }));
  }, [externalDepsData]);

  // ── Database layer ──────────────────────────────────────────────
  const dbLayerData = useMemo(() => {
    if (!imports) return { matches: [] as DbPackageMatch[], byCategory: new Map<DbCategory, DbPackageMatch[]>() };
    const matches = detectDatabasePackages(imports.external);
    const byCategory = new Map<DbCategory, DbPackageMatch[]>();
    for (const m of matches) {
      const list = byCategory.get(m.category) ?? [];
      list.push(m);
      byCategory.set(m.category, list);
    }
    return { matches, byCategory };
  }, [imports]);

  const dbChartData = useMemo(() => {
    return dbLayerData.matches.map((m) => ({
      label: m.ext.package,
      value: m.ext.importedBy.length,
      color: m.category === "driver" ? "var(--accent)"
        : m.category === "orm" ? "#9b7af8"
        : m.category === "cache" ? "var(--green)"
        : "var(--orange)",
    }));
  }, [dbLayerData]);

  // ── Handler-to-database flow ────────────────────────────────────
  const handlerDbTraces = useMemo(() => {
    if (!imports || !data.components) return [];
    const groups = data.components.serverRoutes ?? [];
    if (groups.length === 0) return [];

    const dbFileToPackages = new Map<string, string[]>();
    for (const ext of imports.external) {
      if (classifyDbPackage(ext.package) !== null) {
        for (const file of ext.importedBy) {
          const list = dbFileToPackages.get(file) ?? [];
          list.push(ext.package);
          dbFileToPackages.set(file, list);
        }
      }
    }

    if (dbFileToPackages.size === 0) return [];

    const fileImports = new Map<string, string[]>();
    for (const edge of imports.edges) {
      const targets = fileImports.get(edge.from) ?? [];
      targets.push(edge.to);
      fileImports.set(edge.from, targets);
    }

    const MAX_DEPTH = 3;
    const traces: Array<{ method: string; path: string; handlerFile: string; dbPackages: string[]; depth: number }> = [];
    const seen = new Set<string>();

    for (const group of groups) {
      for (const route of group.routes) {
        const key = `${route.method}:${route.path}:${route.file}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const visited = new Set<string>();
        const queue: Array<{ file: string; depth: number }> = [{ file: route.file, depth: 0 }];
        const found = new Set<string>();
        let minDepth = MAX_DEPTH + 1;

        while (queue.length > 0) {
          const { file, depth } = queue.shift()!;
          if (visited.has(file)) continue;
          visited.add(file);

          const dbPkgs = dbFileToPackages.get(file);
          if (dbPkgs) {
            for (const pkg of dbPkgs) found.add(pkg);
            if (depth < minDepth) minDepth = depth;
          }

          if (depth < MAX_DEPTH) {
            for (const next of fileImports.get(file) ?? []) {
              if (!visited.has(next)) queue.push({ file: next, depth: depth + 1 });
            }
          }
        }

        if (found.size > 0) {
          traces.push({
            method: route.method,
            path: route.path,
            handlerFile: route.file,
            dbPackages: [...found].sort(),
            depth: minDepth,
          });
        }
      }
    }

    return traces.sort((a, b) => a.path.localeCompare(b.path));
  }, [imports, data.components]);

  // ── Package-level dependency flow ───────────────────────────────
  const packageDeps = useMemo(() => {
    if (!imports) return { nodes: [] as Array<{ id: string; label: string; color: string }>, edges: [] as Array<{ from: string; to: string; weight: number }>, fanIn: [] as Array<{ label: string; value: number; color: string }> };

    const edges = imports.edges;
    function getPackage(filePath: string): string {
      const parts = filePath.split("/");
      if (parts.length >= 2 && parts[0] === "packages") {
        return parts[1];
      }
      return parts[0];
    }

    const pairWeights = new Map<string, number>();
    const packageSet = new Set<string>();

    for (const edge of edges) {
      const fromPkg = getPackage(edge.from);
      const toPkg = getPackage(edge.to);
      packageSet.add(fromPkg);
      packageSet.add(toPkg);
      if (fromPkg === toPkg) continue;
      const key = `${fromPkg}->${toPkg}`;
      pairWeights.set(key, (pairWeights.get(key) ?? 0) + 1);
    }

    if (pairWeights.size === 0) return { nodes: [], edges: [], fanIn: [] };

    const flowEdges = [...pairWeights.entries()].map(([key, weight]) => {
      const [from, to] = key.split("->");
      return { from, to, weight };
    });

    const fanInMap = new Map<string, Set<string>>();
    for (const [key] of pairWeights) {
      const [from, to] = key.split("->");
      if (!fanInMap.has(to)) fanInMap.set(to, new Set());
      fanInMap.get(to)!.add(from);
    }

    const participatingPkgs = new Set<string>();
    for (const [key] of pairWeights) {
      const [from, to] = key.split("->");
      participatingPkgs.add(from);
      participatingPkgs.add(to);
    }

    const pkgColors = new Map<string, string>();
    const PACKAGE_COLORS = [
      "var(--accent)", "var(--green)", "var(--orange)", "var(--red)",
      "#7dd3fc", "#fbbf24", "#6c41f0", "#d52e66",
    ];
    const sortedPkgs = [...participatingPkgs].sort();
    sortedPkgs.forEach((pkg, i) => {
      pkgColors.set(pkg, PACKAGE_COLORS[i % PACKAGE_COLORS.length]);
    });

    const flowNodes = sortedPkgs.map((pkg) => ({
      id: pkg,
      label: pkg,
      color: pkgColors.get(pkg) ?? "var(--accent)",
    }));

    const fanInData = [...fanInMap.entries()]
      .map(([pkg, importers]) => ({
        label: pkg,
        value: importers.size,
        color: importers.size > 4 ? "var(--red)" : importers.size > 2 ? "var(--orange)" : "var(--accent)",
      }))
      .sort((a, b) => b.value - a.value);

    return { nodes: flowNodes, edges: flowEdges, fanIn: fanInData };
  }, [imports]);

  // ── Move-file findings ──────────────────────────────────────────
  const moveFileFindings = categorized["move-file"];

  // ── Problems by zone (for chart) ───────────────────────────────
  const problemsByZone = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of categorized.problems) {
      if (f.scope && f.scope !== "global") {
        map.set(f.scope, (map.get(f.scope) || 0) + 1);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([zone, count]) => ({
        label: zone,
        value: count,
        color: count >= 3 ? "var(--red)" : count >= 2 ? "var(--orange)" : "var(--accent)",
      }));
  }, [categorized.problems]);

  // ── Render ──────────────────────────────────────────────────────

  return h("div", null,
    // Header
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Analysis"),
    ),
    h("p", { class: "section-sub" },
      `${allFindings.length} findings from ${zones?.zones.length ?? 0} zones`
    ),

    // Enrichment notice for pending categories
    pendingCategories.length > 0
      ? h("div", { class: "analysis-enrichment-notice", role: "status" },
          h("span", { class: "finding-icon", "aria-hidden": "true" }, "\u2139"),
          h("span", null,
            "Additional findings available at higher enrichment passes: ",
            pendingCategories.map((cat, i) =>
              h(Fragment, { key: cat },
                i > 0 ? ", " : null,
                h("strong", null, CATEGORY_META[cat].label),
                ` (pass ${CATEGORY_META[cat].minPass})`,
              )
            ),
            ". Run ",
            h("code", null, "sourcevision analyze"),
            " to unlock.",
          ),
        )
      : null,

    // Category pills
    h("div", { class: "analysis-category-pills", role: "tablist", "aria-label": "Finding categories" },
      h("button", {
        class: `analysis-pill${activeCategory === "all" ? " analysis-pill-active" : ""}`,
        role: "tab",
        "aria-selected": String(activeCategory === "all"),
        onClick: () => setActiveCategory("all"),
      }, `All (${allFindings.length})`),
      ...CATEGORY_ORDER.map((cat) => {
        const count = categorized[cat].length;
        const meta = CATEGORY_META[cat];
        const locked = enrichmentPass < meta.minPass;
        return h("button", {
          key: cat,
          class: `analysis-pill${activeCategory === cat ? " analysis-pill-active" : ""}${locked ? " analysis-pill-locked" : ""}`,
          role: "tab",
          "aria-selected": String(activeCategory === cat),
          "aria-disabled": locked ? "true" : undefined,
          onClick: locked ? undefined : () => setActiveCategory(cat),
          title: locked ? `Requires enrichment pass ${meta.minPass}` : undefined,
        },
          h("span", { "aria-hidden": "true" }, meta.icon),
          ` ${meta.label}`,
          locked
            ? h("span", { class: "nav-badge" }, `P${meta.minPass}`)
            : ` (${count})`,
        );
      }),
    ),

    // Severity filter pills
    h("div", { class: "analysis-severity-pills", role: "group", "aria-label": "Severity filter" },
      h("span", { class: "analysis-filter-label" }, "Severity:"),
      ...([
        { key: "all" as SeverityFilter, label: "All" },
        { key: "critical" as SeverityFilter, label: "\u26D4 Critical", count: severityCounts.critical },
        { key: "warning" as SeverityFilter, label: "\u26A0 Warning", count: severityCounts.warning },
        { key: "info" as SeverityFilter, label: "\u2139 Info", count: severityCounts.info },
      ].map(({ key, label, count }) =>
        h("button", {
          key,
          class: `analysis-severity-pill${severityFilter === key ? " analysis-severity-pill-active" : ""}${key !== "all" && count === 0 ? " analysis-severity-pill-empty" : ""}`,
          onClick: () => setSeverityFilter(key),
          "aria-pressed": String(severityFilter === key),
        }, key === "all" ? label : `${label} (${count})`)
      )),
    ),

    // Summary stat cards
    h("div", { class: "stat-grid" },
      h("div", { class: "stat-card" },
        h("div", { class: "value" }, String(categorized.architecture.length)),
        h("div", { class: "label" }, "Patterns & Relationships")
      ),
      h("div", { class: "stat-card" },
        h("div", { class: `value${severityCounts.critical > 0 ? " text-red" : ""}` },
          String(categorized.problems.length)),
        h("div", { class: "label" }, "Anti-Patterns")
      ),
      h("div", { class: "stat-card" },
        h("div", { class: "value" }, String(categorized.suggestions.length)),
        h("div", { class: "label" }, "Suggestions")
      ),
      h("div", { class: "stat-card" },
        h("div", { class: "value" }, String(crossingCount)),
        h("div", { class: "label" }, "Cross-Zone Imports")
      ),
    ),

    // ── Architecture visualizations ─────────────────────────────
    (activeCategory === "all" || activeCategory === "architecture")
      ? h(Fragment, null,
          // Zone health bar chart
          zoneHealthData.length > 0
            ? h(Fragment, null,
                h("h3", { class: "section-header-sm mt-24" }, "Zone Sizes"),
                h("p", { class: "section-sub" }, "Files per zone. Green = high cohesion, orange = moderate, red = low."),
                h(BarChart, { data: zoneHealthData }),
              )
            : null,

          // Hub files bar chart
          hubFilesData.length > 0
            ? h(Fragment, null,
                h("h3", { class: "section-header-sm mt-24" }, "Hub Files"),
                h("p", { class: "section-sub" }, "Most-imported files. Red = high coupling risk (>10 importers), orange = moderate (>5)."),
                h(BarChart, { data: hubFilesData }),
              )
            : null,

          // External Dependencies section
          externalDepsData.all.length > 0
            ? h(Fragment, null,
                h("h3", { class: "section-header-sm mt-24" }, "External Dependencies"),
                h("p", { class: "section-sub" },
                  externalDepsData.hasKind
                    ? `${externalDepsData.thirdParty.length} third-party, ${externalDepsData.stdlib.length} stdlib packages`
                    : `${externalDepsData.all.length} external packages sorted by usage`
                ),

                topDepsChartData.length > 0
                  ? h(Fragment, null,
                      externalDepsData.hasKind
                        ? h("h4", { class: "section-header-sm mt-16" }, "Third-Party Packages")
                        : null,
                      h(BarChart, { data: topDepsChartData }),
                    )
                  : null,

                stdlibChartData.length > 0
                  ? h(Fragment, null,
                      h("h4", { class: "section-header-sm mt-24" }, "Standard Library"),
                      h(BarChart, { data: stdlibChartData }),
                    )
                  : null,

                h(CollapsibleSection, {
                    title: externalDepsData.hasKind ? "All External Packages" : "Package Details",
                    count: externalDepsData.all.length,
                    defaultOpen: false,
                    threshold: 20,
                  },
                  h("div", { class: "data-table-wrapper" },
                    h("table", { class: "data-table" },
                      h("thead", null,
                        h("tr", null,
                          h("th", null, "Package"),
                          externalDepsData.hasKind ? h("th", null, "Kind") : null,
                          h("th", null, "Importers"),
                          h("th", null, "Symbols"),
                        )
                      ),
                      h("tbody", null,
                        externalDepsData.all.map((ext) => {
                          const isStdlib = ext.kind === "stdlib" || (!ext.kind && ext.package.startsWith("stdlib:"));
                          return h("tr", { key: ext.package },
                            h("td", null, ext.package),
                            externalDepsData.hasKind
                              ? h("td", null,
                                  h("span", {
                                    class: `tag ${isStdlib ? "tag-docs" : "tag-source"}`,
                                  }, isStdlib ? "stdlib" : "third-party")
                                )
                              : null,
                            h("td", null, String(ext.importedBy.length)),
                            h("td", null, ext.symbols.length > 3
                              ? `${ext.symbols.slice(0, 3).join(", ")}… +${ext.symbols.length - 3}`
                              : ext.symbols.join(", ")
                            ),
                          );
                        })
                      )
                    )
                  )
                ),
              )
            : null,

          // Database Layer section
          dbLayerData.matches.length > 0
            ? h(Fragment, null,
                h("h3", { class: "section-header-sm mt-24" }, "Database Layer"),
                h("p", { class: "section-sub" },
                  `${dbLayerData.matches.length} database package${dbLayerData.matches.length === 1 ? "" : "s"} detected across ${dbLayerData.byCategory.size} categor${dbLayerData.byCategory.size === 1 ? "y" : "ies"}`
                ),

                h("div", { class: "stat-grid" },
                  ...[...dbLayerData.byCategory.entries()].map(([cat, items]) =>
                    h("div", { class: "stat-card", key: cat },
                      h("div", { class: "value" }, String(items.length)),
                      h("div", { class: "label" }, DB_CATEGORY_LABELS[cat]),
                    )
                  ),
                ),

                dbChartData.length > 0
                  ? h(BarChart, { data: dbChartData })
                  : null,

                h(CollapsibleSection, {
                    title: "Database Packages",
                    count: dbLayerData.matches.length,
                    defaultOpen: dbLayerData.matches.length <= 10,
                    threshold: 10,
                  },
                  h("div", { class: "data-table-wrapper" },
                    h("table", { class: "data-table" },
                      h("thead", null,
                        h("tr", null,
                          h("th", null, "Package"),
                          h("th", null, "Category"),
                          h("th", null, "Importers"),
                          h("th", null, "Symbols"),
                        )
                      ),
                      h("tbody", null,
                        dbLayerData.matches.map((m) =>
                          h("tr", { key: m.ext.package },
                            h("td", null, m.ext.package),
                            h("td", null,
                              h("span", {
                                class: `tag ${DB_CATEGORY_TAG_CLASS[m.category]}`,
                              }, DB_CATEGORY_LABELS[m.category])
                            ),
                            h("td", null, String(m.ext.importedBy.length)),
                            h("td", null, m.ext.symbols.length > 3
                              ? `${m.ext.symbols.slice(0, 3).join(", ")}… +${m.ext.symbols.length - 3}`
                              : m.ext.symbols.join(", ")
                            ),
                          )
                        )
                      )
                    )
                  )
                ),
              )
            : null,

          // Handler → Database Flow section
          handlerDbTraces.length > 0
            ? h(Fragment, null,
                h("h3", { class: "section-header-sm mt-24" }, "Handler \u2192 Database Flow"),
                h("p", { class: "section-sub" },
                  `${handlerDbTraces.length} handler${handlerDbTraces.length === 1 ? "" : "s"} with database access paths (within 3 import hops)`
                ),
                h(CollapsibleSection, {
                    title: "Handler Traces",
                    count: handlerDbTraces.length,
                    defaultOpen: handlerDbTraces.length <= 15,
                    threshold: 15,
                  },
                  h("div", { class: "data-table-wrapper" },
                    h("table", { class: "data-table" },
                      h("thead", null,
                        h("tr", null,
                          h("th", null, "Method"),
                          h("th", null, "Route"),
                          h("th", null, "DB Packages"),
                          h("th", null, "Hops"),
                        )
                      ),
                      h("tbody", null,
                        handlerDbTraces.map((trace) =>
                          h("tr", { key: `${trace.method}:${trace.path}` },
                            h("td", null,
                              h("span", { class: `tag ${methodTagClass(trace.method)}` }, trace.method)
                            ),
                            h("td", null, trace.path),
                            h("td", null,
                              trace.dbPackages.length > 2
                                ? `${trace.dbPackages.slice(0, 2).join(", ")} +${trace.dbPackages.length - 2}`
                                : trace.dbPackages.join(", ")
                            ),
                            h("td", null, trace.depth === 0 ? "direct" : String(trace.depth)),
                          )
                        )
                      )
                    )
                  ),
                ),
              )
            : null,

          // Package Dependencies section
          packageDeps.nodes.length > 0
            ? h(Fragment, null,
                h("h3", { class: "section-header-sm mt-24" }, "Package Dependencies"),
                h("p", { class: "section-sub" },
                  `${packageDeps.nodes.length} packages with ${packageDeps.edges.length} cross-package dependency edges`
                ),

                h(FlowDiagram, {
                  nodes: packageDeps.nodes,
                  edges: packageDeps.edges,
                }),

                packageDeps.fanIn.length > 0
                  ? h(Fragment, null,
                      h("h4", { class: "section-header-sm mt-16" }, "Fan-In (Dependents)"),
                      h("p", { class: "section-sub" }, "Packages sorted by number of internal dependents. High fan-in = foundational."),
                      h(BarChart, { data: packageDeps.fanIn }),
                    )
                  : null,

                h(CollapsibleSection, {
                    title: "Dependency Edges",
                    count: packageDeps.edges.length,
                    defaultOpen: false,
                    threshold: 10,
                  },
                  h("div", { class: "data-table-wrapper" },
                    h("table", { class: "data-table" },
                      h("thead", null,
                        h("tr", null,
                          h("th", null, "From"),
                          h("th", null, "To"),
                          h("th", null, "Weight"),
                        )
                      ),
                      h("tbody", null,
                        [...packageDeps.edges]
                          .sort((a, b) => b.weight - a.weight)
                          .map((edge) =>
                            h("tr", { key: `${edge.from}->${edge.to}` },
                              h("td", null, edge.from),
                              h("td", null, edge.to),
                              h("td", null, String(edge.weight)),
                            )
                          )
                      )
                    )
                  )
                ),
              )
            : null,
        )
      : null,

    // ── Problems by zone chart (when problems category active) ──
    (activeCategory === "all" || activeCategory === "problems") && problemsByZone.length > 0
      ? h(Fragment, null,
          h("h3", { class: "section-header-sm mt-24" }, "Problems by Zone"),
          h("p", { class: "section-sub" }, "Which zones have the most anti-patterns."),
          h(BarChart, { data: problemsByZone }),
        )
      : null,

    // ── Move-file recommendations ─────────────────────────────────
    (activeCategory === "all" || activeCategory === "move-file") && moveFileFindings.length > 0
      ? h(Fragment, null,
          h("h3", { class: "section-header-sm mt-24" }, "Move File Recommendations"),
          h("p", { class: "section-sub" },
            `${moveFileFindings.length} file${moveFileFindings.length === 1 ? "" : "s"} suggested for relocation`
          ),
          ...filterBySeverity(moveFileFindings).map((f, i) =>
            h("div", {
              key: i,
              class: `move-file-card severity-${f.severity || "info"}`,
              role: "article",
            },
              h("div", { class: "move-file-header" },
                h("span", { class: "finding-icon", "aria-hidden": "true" }, "\u21E5"),
                h("span", { class: `severity-badge severity-${f.severity || "info"}` },
                  f.severity || "info"
                ),
                f.scope && f.scope !== "global"
                  ? h("span", { class: "finding-scope-link" },
                      h("span", { class: "finding-zone-dot", style: "background: var(--accent)" }),
                      f.scope,
                    )
                  : null,
              ),
              h("p", { class: "move-file-rationale" }, f.text),
              h("div", { class: "move-file-paths" },
                f.from
                  ? h("div", { class: "move-file-path" },
                      h("span", { class: "move-file-path-label" }, "From:"),
                      h("code", { class: "move-file-path-value" },
                        navigateTo
                          ? h("button", {
                              class: "related-chip related-chip-file",
                              onClick: () => navigateTo("files", { file: f.from! }),
                            }, f.from)
                          : f.from
                      ),
                    )
                  : null,
                f.to
                  ? h("div", { class: "move-file-path" },
                      h("span", { class: "move-file-path-label" }, "To:"),
                      h("code", { class: "move-file-path-value" }, f.to),
                    )
                  : null,
              ),
              f.related?.length
                ? h("div", { class: "finding-meta" },
                    h("span", { class: "finding-related-label" }, "Related:"),
                    h("div", { class: "finding-related" },
                      f.related.map((r, j) =>
                        navigateTo
                          ? h("button", {
                              key: j,
                              class: "related-chip related-chip-file",
                              onClick: () => navigateTo("files", { file: r }),
                            }, r)
                          : h("code", { key: j }, r)
                      )
                    )
                  )
                : null,
            )
          ),
        )
      : null,

    // ── Findings list ─────────────────────────────────────────────
    h(FindingsList, {
      findings: activeCategory === "move-file"
        ? [] // move-file shown as cards above
        : visibleFindings.filter((f) => f.type !== "move-file"),
      legacyInsights,
      groupBy: activeCategory === "all" ? "type" : "severity",
      searchable: true,
      navigateTo,
      zones,
    })
  );
}

function shortFilePath(path: string): string {
  const parts = path.split("/");
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : path;
}

function methodTagClass(method: string): string {
  switch (method) {
    case "GET": return "tag-source";
    case "POST": return "tag-docs";
    case "DELETE": return "tag-test";
    case "PUT":
    case "PATCH": return "tag-config";
    default: return "tag-other";
  }
}
