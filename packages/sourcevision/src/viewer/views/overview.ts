import { h } from "preact";
import { useMemo } from "preact/hooks";
import type { LoadedData } from "../types.js";
import { BarChart } from "../components/mini-charts.js";
import { CollapsibleSection } from "../components/collapsible-section.js";

interface OverviewProps {
  data: LoadedData;
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

export function Overview({ data }: OverviewProps) {
  const { manifest, inventory, imports, zones } = data;

  if (!manifest && !inventory && !imports && !zones) {
    return h("div", { class: "loading" }, "No data loaded. Use 'sourcevision serve' or drop files.");
  }

  const hasZones = zones && zones.zones.length > 0;
  const hasImports = imports && imports.edges.length > 0;
  const showGettingStarted = manifest && (!hasImports || !hasZones);

  const stats: Array<{ value: string | number; label: string }> = [];

  if (inventory) {
    stats.push(
      { value: inventory.summary.totalFiles, label: "Files" },
      { value: inventory.summary.totalLines.toLocaleString(), label: "Lines of Code" },
      { value: Object.keys(inventory.summary.byLanguage).length, label: "Languages" }
    );
  }

  if (imports) {
    stats.push(
      { value: imports.summary.totalEdges, label: "Import Edges" },
      { value: imports.summary.totalExternal, label: "External Packages" },
      { value: imports.summary.circularCount, label: "Circular Deps" }
    );
  }

  if (zones) {
    stats.push(
      { value: zones.zones.length, label: "Zones" },
      { value: zones.crossings.length, label: "Zone Crossings" },
      { value: zones.unzoned.length, label: "Unzoned Files" }
    );
  }

  // Language bar chart data
  const langChartData = useMemo(() => {
    if (!inventory) return [];
    return Object.entries(inventory.summary.byLanguage)
      .sort(([, a], [, b]) => b - a)
      .map(([lang, count]) => ({
        label: lang,
        value: count,
        color: LANG_COLORS[lang] || "var(--accent)",
      }));
  }, [inventory]);

  // Most imported bar chart (top 5)
  const importChartData = useMemo(() => {
    if (!imports?.summary.mostImported.length) return [];
    return imports.summary.mostImported.slice(0, 5).map((f) => ({
      label: f.path.split("/").pop() || f.path,
      value: f.count,
    }));
  }, [imports]);

  return h("div", null,
    h("h2", { class: "section-header" }, "Overview"),
    manifest
      ? h("p", { class: "section-sub" },
          `Analyzed ${manifest.targetPath.split("/").pop()} `,
          manifest.gitBranch ? `on ${manifest.gitBranch} ` : "",
          manifest.gitSha ? `(${manifest.gitSha.slice(0, 7)}) ` : "",
          `at ${new Date(manifest.analyzedAt).toLocaleString()}`
        )
      : null,

    // Getting Started card
    showGettingStarted
      ? h("div", { class: "getting-started" },
          h("h3", null, "Getting Started"),
          h("p", null, "Sourcevision analyzes your codebase in phases. Here's what to run next:"),
          h("ol", null,
            !hasImports
              ? h("li", null, h("code", null, "sourcevision analyze --phase=2"), " — Build the import graph")
              : null,
            !hasZones
              ? h("li", null, h("code", null, "sourcevision analyze --phase=3"), " — Detect architectural zones")
              : null,
            h("li", null, h("code", null, "sourcevision analyze"), " — Run all phases (including AI enrichment)"),
          ),
          h("p", { class: "text-dim mt-8", style: "font-size: 12px" },
            "Use ", h("code", null, "--fast"), " to skip AI enrichment for quick structural analysis."
          ),
        )
      : null,

    // Stats grid
    h("div", { class: "stat-grid" },
      stats.map((s, i) =>
        h("div", { key: i, class: "stat-card" },
          h("div", { class: "value" }, s.value),
          h("div", { class: "label" }, s.label)
        )
      )
    ),

    // Language breakdown — BarChart + collapsible table
    inventory
      ? h("div", null,
          h("h3", { class: "section-header-sm mt-24" },
            "Languages"
          ),
          h(BarChart, { data: langChartData }),
          h(CollapsibleSection, {
            title: "Language Details",
            count: langChartData.length,
            defaultOpen: false,
            threshold: 20,
          },
            h("table", { class: "data-table" },
              h("thead", null,
                h("tr", null,
                  h("th", null, "Language"),
                  h("th", null, "Files"),
                  h("th", null, "% of Total")
                )
              ),
              h("tbody", null,
                Object.entries(inventory.summary.byLanguage)
                  .sort(([, a], [, b]) => b - a)
                  .map(([lang, count]) =>
                    h("tr", { key: lang },
                      h("td", null, lang),
                      h("td", null, count),
                      h("td", null,
                        `${((count / inventory.summary.totalFiles) * 100).toFixed(1)}%`
                      )
                    )
                  )
              )
            )
          )
        )
      : null,

    // Most imported files — BarChart + collapsible full list
    imports?.summary.mostImported.length
      ? h("div", null,
          h("h3", { class: "section-header-sm mt-24" },
            "Most Imported Files"
          ),
          h(BarChart, { data: importChartData }),
          h(CollapsibleSection, {
            title: "Full Import List",
            count: imports.summary.mostImported.length,
            defaultOpen: false,
            threshold: 10,
          },
            h("table", { class: "data-table" },
              h("thead", null,
                h("tr", null,
                  h("th", null, "File"),
                  h("th", null, "Imported By")
                )
              ),
              h("tbody", null,
                imports.summary.mostImported.map((f) =>
                  h("tr", { key: f.path },
                    h("td", null, f.path),
                    h("td", null, f.count)
                  )
                )
              )
            )
          )
        )
      : null,

    // Circular dependencies
    imports?.summary.circulars.length
      ? h(CollapsibleSection, {
          title: `Circular Dependencies`,
          count: imports.summary.circularCount,
          defaultOpen: true,
          threshold: 5,
        },
          ...imports.summary.circulars.map((c, i) =>
            h("div", {
              key: i,
              class: "circular-dep-block",
            },
              c.cycle.join(" \u2192 ") + " \u2192 " + c.cycle[0]
            )
          )
        )
      : null,

    // Module status
    manifest
      ? h("div", null,
          h("h3", { class: "section-header-sm mt-24" },
            "Module Status"
          ),
          h("table", { class: "data-table" },
            h("thead", null,
              h("tr", null,
                h("th", null, "Module"),
                h("th", null, "Status"),
                h("th", null, "Completed")
              )
            ),
            h("tbody", null,
              Object.entries(manifest.modules).map(([name, info]) =>
                h("tr", { key: name },
                  h("td", null, name),
                  h("td", null,
                    h("span", {
                      class: `tag tag-${info.status === "complete" ? "test" : info.status === "error" ? "other" : "source"}`,
                    }, info.status)
                  ),
                  h("td", null, info.completedAt ? new Date(info.completedAt).toLocaleTimeString() : "\u2014")
                )
              )
            )
          )
        )
      : null
  );
}
