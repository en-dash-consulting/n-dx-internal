/**
 * Functions catalog — full searchable/filterable table of all functions
 * aggregated from call-graph and zone data.
 *
 * Renders inside the Explorer "Functions" sub-tab.
 */
import { h } from "preact";
import { useState, useMemo, useCallback } from "preact/hooks";
import type { LoadedData, NavigateTo } from "../types.js";
import type { CallGraph, FunctionNode } from "../external.js";
import { buildFileToZoneMap, getZoneColorByIndex } from "../visualization/index.js";
import { basename } from "../utils.js";

// ── Types ───────────────────────────────────────────────────────────

/** A single row in the functions table. */
export interface FunctionRow {
  qualifiedName: string;
  file: string;
  zoneName: string;
  zoneId: string;
  zoneColor: string;
  incoming: number;
  outgoing: number;
}

type FnSortKey = "qualifiedName" | "file" | "zoneName" | "incoming" | "outgoing";
type SortDir = "asc" | "desc";

// ── Data aggregation ────────────────────────────────────────────────

/**
 * Build a flat list of FunctionRow from callGraph + zones.
 * Counts incoming and outgoing calls per function from edge data.
 */
export function buildFunctionRows(
  callGraph: CallGraph,
  fileToZone: Map<string, { id: string; name: string; color: string }>,
): FunctionRow[] {
  // Count incoming/outgoing per function key
  const outgoingCounts = new Map<string, number>();
  const incomingCounts = new Map<string, number>();

  for (const edge of callGraph.edges) {
    if (!edge.calleeFile) continue;

    const callerKey = `${edge.callerFile}:${edge.caller}`;
    const calleeKey = `${edge.calleeFile}:${edge.callee}`;

    outgoingCounts.set(callerKey, (outgoingCounts.get(callerKey) ?? 0) + 1);
    incomingCounts.set(calleeKey, (incomingCounts.get(calleeKey) ?? 0) + 1);
  }

  return callGraph.functions.map((fn: FunctionNode) => {
    const key = `${fn.file}:${fn.qualifiedName}`;
    const zone = fileToZone.get(fn.file);
    return {
      qualifiedName: fn.qualifiedName,
      file: fn.file,
      zoneName: zone?.name ?? "Unzoned",
      zoneId: zone?.id ?? "__unzoned__",
      zoneColor: zone?.color ?? "var(--text-dim)",
      incoming: incomingCounts.get(key) ?? 0,
      outgoing: outgoingCounts.get(key) ?? 0,
    };
  });
}

// ── Component ───────────────────────────────────────────────────────

interface FunctionsCatalogProps {
  data: LoadedData;
  navigateTo?: NavigateTo;
}

export function FunctionsCatalog({ data }: FunctionsCatalogProps) {
  const { callGraph, zones } = data;

  // Filter state
  const [search, setSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState("all");

  // Sort state
  const [sortKey, setSortKey] = useState<FnSortKey>("incoming");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Pagination
  const [showCount, setShowCount] = useState(100);

  // Build zone map
  const fileToZone = useMemo(() => buildFileToZoneMap(zones), [zones]);

  const zoneList = useMemo(() => {
    if (!zones) return [];
    return zones.zones.map((z, i) => ({
      id: z.id,
      name: z.name,
      color: getZoneColorByIndex(i),
    }));
  }, [zones]);

  // Build function rows
  const allRows = useMemo(() => {
    if (!callGraph) return [];
    return buildFunctionRows(callGraph, fileToZone);
  }, [callGraph, fileToZone]);

  // Filter rows
  const filtered = useMemo(() => {
    let rows = allRows;

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.qualifiedName.toLowerCase().includes(q) ||
          r.file.toLowerCase().includes(q),
      );
    }

    if (zoneFilter !== "all") {
      rows = rows.filter((r) => r.zoneId === zoneFilter);
    }

    // Sort
    rows = [...rows].sort((a, b) => {
      let cmp: number;
      switch (sortKey) {
        case "qualifiedName":
          cmp = a.qualifiedName.localeCompare(b.qualifiedName);
          break;
        case "file":
          cmp = a.file.localeCompare(b.file);
          break;
        case "zoneName":
          cmp = a.zoneName.localeCompare(b.zoneName);
          break;
        case "incoming":
          cmp = a.incoming - b.incoming;
          break;
        case "outgoing":
          cmp = a.outgoing - b.outgoing;
          break;
        default:
          cmp = 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [allRows, search, zoneFilter, sortKey, sortDir]);

  // Reset show count when filters change
  useMemo(() => setShowCount(100), [search, zoneFilter]);

  const toggleSort = useCallback((key: FnSortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(key === "incoming" || key === "outgoing" ? "desc" : "asc");
      return key;
    });
  }, []);

  const sortIndicator = (key: FnSortKey): string => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  };

  if (!callGraph) {
    return h("div", { class: "empty-state" },
      h("p", { class: "section-sub" }, "No call graph data available. Run a deep analysis to generate function data."),
    );
  }

  const visible = filtered.slice(0, showCount);
  const remaining = filtered.length - showCount;

  return h("div", { class: "functions-catalog" },
    // Summary line
    h("p", { class: "section-sub" },
      `${callGraph.summary.totalFunctions.toLocaleString()} functions across ${callGraph.summary.filesWithCalls.toLocaleString()} files`,
      callGraph.summary.totalCalls > 0
        ? ` \u2022 ${callGraph.summary.totalCalls.toLocaleString()} call edges`
        : "",
      callGraph.summary.cycleCount > 0
        ? ` \u2022 ${callGraph.summary.cycleCount} cycles`
        : "",
    ),

    // Filter bar
    h("div", { class: "filter-bar" },
      h("input", {
        class: "filter-input",
        type: "search",
        placeholder: "Search functions or files...",
        value: search,
        "aria-label": "Search functions",
        onInput: (e: Event) => setSearch((e.target as HTMLInputElement).value),
      }),
      zoneList.length > 0
        ? h("select", {
            class: "filter-select",
            value: zoneFilter,
            "aria-label": "Filter by zone",
            onChange: (e: Event) => setZoneFilter((e.target as HTMLSelectElement).value),
          },
            h("option", { value: "all" }, "All Zones"),
            zoneList.map((z) => h("option", { key: z.id, value: z.id }, z.name)),
            h("option", { value: "__unzoned__" }, "Unzoned"),
          )
        : null,
      h("span", { class: "filter-result-count" },
        `Showing ${Math.min(showCount, filtered.length)} of ${filtered.length} functions`,
      ),
    ),

    // Table
    h("div", { class: "data-table-wrapper" },
      h("table", { class: "data-table" },
        h("thead", null,
          h("tr", null,
            h("th", {
              onClick: () => toggleSort("qualifiedName"),
              style: "cursor: pointer;",
            }, `Function${sortIndicator("qualifiedName")}`),
            h("th", {
              onClick: () => toggleSort("file"),
              style: "cursor: pointer;",
            }, `File${sortIndicator("file")}`),
            h("th", {
              onClick: () => toggleSort("zoneName"),
              style: "cursor: pointer;",
            }, `Zone${sortIndicator("zoneName")}`),
            h("th", {
              onClick: () => toggleSort("incoming"),
              style: "cursor: pointer; text-align: right;",
            }, `Incoming${sortIndicator("incoming")}`),
            h("th", {
              onClick: () => toggleSort("outgoing"),
              style: "cursor: pointer; text-align: right;",
            }, `Outgoing${sortIndicator("outgoing")}`),
          ),
        ),
        h("tbody", null,
          visible.map((row, i) =>
            h("tr", { key: `${row.file}:${row.qualifiedName}:${i}` },
              h("td", { class: "mono-sm", title: row.qualifiedName }, row.qualifiedName),
              h("td", { class: "text-dim", title: row.file }, basename(row.file)),
              h("td", null,
                row.zoneId !== "__unzoned__"
                  ? h("span", {
                      class: "zone-badge",
                      style: `--zone-color: ${row.zoneColor}`,
                    }, row.zoneName)
                  : h("span", { class: "text-dim" }, "Unzoned"),
              ),
              h("td", { class: "text-right", style: "font-weight: 600;" }, String(row.incoming)),
              h("td", { class: "text-right", style: "font-weight: 600;" }, String(row.outgoing)),
            ),
          ),
        ),
      ),
    ),

    // Load more button
    remaining > 0
      ? h("div", { class: "empty-state" },
          h("button", {
            class: "collapsible-toggle",
            onClick: () => setShowCount(showCount + 100),
          }, `Show ${Math.min(remaining, 100)} more (${remaining} remaining)`),
        )
      : null,
  );
}
