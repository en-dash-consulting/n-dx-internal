import { h, Fragment } from "preact";
import { useMemo } from "preact/hooks";
import type { LoadedData, NavigateTo, DetailItem } from "../types.js";
import type { Finding, ExternalImport } from "../external.js";
import { FindingsList, BarChart, FlowDiagram, CollapsibleSection } from "../visualization/index.js";
import { ENRICHMENT_THRESHOLDS } from "./enrichment-thresholds.js";
import { BrandedHeader } from "../components/logos.js";
import { detectDatabasePackages, classifyDbPackage, DB_CATEGORY_LABELS, DB_CATEGORY_TAG_CLASS } from "./db-packages.js";
import type { DbCategory, DbPackageMatch } from "./db-packages.js";

interface ArchitectureProps {
  data: LoadedData;
  onSelect: (detail: DetailItem | null) => void;
  navigateTo?: NavigateTo;
}

export function ArchitectureView({ data, onSelect, navigateTo }: ArchitectureProps) {
  const { zones, imports } = data;
  const enrichmentPass = zones?.enrichmentPass ?? 0;

  if (enrichmentPass < ENRICHMENT_THRESHOLDS.architecture) {
    return h("div", { class: "locked-view" },
      h("div", { class: "locked-icon" }, "\u{1F512}"),
      h("h2", null, "Architecture"),
      h("p", null, "Requires enrichment pass 2 (current: ", enrichmentPass, ")"),
      h("p", { class: "locked-hint" },
        "Run ", h("code", null, "sourcevision analyze"), " again to unlock."
      )
    );
  }

  const findings = (zones?.findings ?? []).filter(
    (f: Finding) => f.type === "pattern" || f.type === "relationship"
  );

  const legacyInsights = findings.length === 0
    ? (zones?.insights ?? []).filter(
        (s) => /pattern|architect|relationship|layer|boundary|abstract/i.test(s)
      )
    : [];

  const patterns = findings.filter((f) => f.type === "pattern");
  const relationships = findings.filter((f) => f.type === "relationship");

  // Zone health overview
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
  const biDirectional = findings.filter((f) => /bidirectional/i.test(f.text)).length;

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

  // External dependencies: stdlib vs third-party breakdown when kind data available
  const externalDepsData = useMemo(() => {
    if (!imports) return { hasKind: false, stdlib: [] as ExternalImport[], thirdParty: [] as ExternalImport[], all: [] as ExternalImport[] };
    const externals = imports.external;
    if (externals.length === 0) return { hasKind: false, stdlib: [] as ExternalImport[], thirdParty: [] as ExternalImport[], all: [] as ExternalImport[] };

    const stdlib: ExternalImport[] = [];
    const thirdParty: ExternalImport[] = [];

    for (const ext of externals) {
      // Use kind field when present; fall back to stdlib: prefix for backward compat
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
    // hasKind is true when kind field is present OR backward-compat stdlib: prefix detected
    const hasKind = externals.some((e) => e.kind != null) || stdlib.length > 0;

    return { hasKind, stdlib, thirdParty, all };
  }, [imports]);

  // Bar chart data for top-N third-party (or all) external deps
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

  // Bar chart data for top-N stdlib packages (only when kind data present)
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

  // Database layer: filter external deps through known database package registry
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

  // Database layer bar chart data
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

  // Handler-to-database flow: trace HTTP handler files through import graph to DB packages
  const handlerDbTraces = useMemo(() => {
    if (!imports || !data.components) return [];
    const groups = data.components.serverRoutes ?? [];
    if (groups.length === 0) return [];

    // Build file → DB packages it directly imports
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

    // Build import adjacency list: file → files it imports
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

        // BFS from handler file through import graph
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

  // Package-level dependency flow: aggregate ImportEdge[] by directory prefix
  const packageDeps = useMemo(() => {
    if (!imports) return { nodes: [] as Array<{ id: string; label: string; color: string }>, edges: [] as Array<{ from: string; to: string; weight: number }>, fanIn: [] as Array<{ label: string; value: number; color: string }> };

    const edges = imports.edges;
    // Determine package prefix from file path: use first 2 segments for "packages/foo/..." style,
    // otherwise the first segment (e.g. "src/..." → "src")
    function getPackage(filePath: string): string {
      const parts = filePath.split("/");
      if (parts.length >= 2 && parts[0] === "packages") {
        return parts[1]; // e.g. "rex", "hench", "web"
      }
      return parts[0]; // e.g. "src", "tests", "cli.js"
    }

    // Aggregate edges by package pair
    const pairWeights = new Map<string, number>();
    const packageSet = new Set<string>();

    for (const edge of edges) {
      const fromPkg = getPackage(edge.from);
      const toPkg = getPackage(edge.to);
      packageSet.add(fromPkg);
      packageSet.add(toPkg);
      if (fromPkg === toPkg) continue; // skip intra-package edges
      const key = `${fromPkg}->${toPkg}`;
      pairWeights.set(key, (pairWeights.get(key) ?? 0) + 1);
    }

    if (pairWeights.size === 0) return { nodes: [], edges: [], fanIn: [] };

    // Build unique flow edges
    const flowEdges = [...pairWeights.entries()].map(([key, weight]) => {
      const [from, to] = key.split("->");
      return { from, to, weight };
    });

    // Compute fan-in: count of unique packages that import INTO each package
    const fanInMap = new Map<string, Set<string>>();
    for (const [key] of pairWeights) {
      const [from, to] = key.split("->");
      if (!fanInMap.has(to)) fanInMap.set(to, new Set());
      fanInMap.get(to)!.add(from);
    }

    // Only include packages that participate in cross-package edges
    const participatingPkgs = new Set<string>();
    for (const [key] of pairWeights) {
      const [from, to] = key.split("->");
      participatingPkgs.add(from);
      participatingPkgs.add(to);
    }

    // Build flow nodes with colors
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

    // Fan-in bar chart sorted descending
    const fanInData = [...fanInMap.entries()]
      .map(([pkg, importers]) => ({
        label: pkg,
        value: importers.size,
        color: importers.size > 4 ? "var(--red)" : importers.size > 2 ? "var(--orange)" : "var(--accent)",
      }))
      .sort((a, b) => b.value - a.value);

    return { nodes: flowNodes, edges: flowEdges, fanIn: fanInData };
  }, [imports]);

  return h("div", null,
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Architecture"),
    ),
    h("p", { class: "section-sub" },
      `${findings.length} findings from ${zones?.zones.length ?? 0} zones`
    ),

    // Summary stats
    h("div", { class: "stat-grid" },
      h("div", { class: "stat-card" },
        h("div", { class: "value" }, String(patterns.length)),
        h("div", { class: "label" }, "Patterns")
      ),
      h("div", { class: "stat-card" },
        h("div", { class: "value" }, String(relationships.length)),
        h("div", { class: "label" }, "Relationships")
      ),
      h("div", { class: "stat-card" },
        h("div", { class: "value" }, String(crossingCount)),
        h("div", { class: "label" }, "Cross-Zone Imports")
      ),
      h("div", { class: "stat-card" },
        h("div", { class: `value${biDirectional > 0 ? " text-orange" : ""}` },
          String(biDirectional)),
        h("div", { class: "label" }, "Bidirectional Couplings")
      ),
    ),

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

          // Third-party (or all) BarChart
          topDepsChartData.length > 0
            ? h(Fragment, null,
                externalDepsData.hasKind
                  ? h("h4", { class: "section-header-sm mt-16" }, "Third-Party Packages")
                  : null,
                h(BarChart, { data: topDepsChartData }),
              )
            : null,

          // Stdlib BarChart (only when kind data available)
          stdlibChartData.length > 0
            ? h(Fragment, null,
                h("h4", { class: "section-header-sm mt-24" }, "Standard Library"),
                h(BarChart, { data: stdlibChartData }),
              )
            : null,

          // Full list table
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

          // Category summary chips
          h("div", { class: "stat-grid" },
            ...[...dbLayerData.byCategory.entries()].map(([cat, items]) =>
              h("div", { class: "stat-card", key: cat },
                h("div", { class: "value" }, String(items.length)),
                h("div", { class: "label" }, DB_CATEGORY_LABELS[cat]),
              )
            ),
          ),

          // Bar chart of all database packages by usage
          dbChartData.length > 0
            ? h(BarChart, { data: dbChartData })
            : null,

          // Detailed table (collapsible)
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
            )
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

          // Flow diagram showing inter-package edges
          h(FlowDiagram, {
            nodes: packageDeps.nodes,
            edges: packageDeps.edges,
          }),

          // Fan-in bar chart: which packages are depended on most
          packageDeps.fanIn.length > 0
            ? h(Fragment, null,
                h("h4", { class: "section-header-sm mt-16" }, "Fan-In (Dependents)"),
                h("p", { class: "section-sub" }, "Packages sorted by number of internal dependents. High fan-in = foundational."),
                h(BarChart, { data: packageDeps.fanIn }),
              )
            : null,

          // Detailed edge table (collapsible)
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

    h(FindingsList, {
      findings,
      legacyInsights,
      groupBy: "type",
      searchable: true,
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
