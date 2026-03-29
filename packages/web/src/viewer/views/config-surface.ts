/**
 * Configuration Surface view — displays env vars, config file references,
 * and global constants with zone attribution.
 */

import { h } from "preact";
import { useRef, useState, useMemo } from "preact/hooks";
import type { LoadedData, NavigateTo, DetailItem } from "../types.js";
import type { ConfigSurfaceEntry, Zone } from "../external.js";
import { ColumnSwitcher } from "../components/column-switcher.js";
import { BrandedHeader } from "../components/logos.js";
import { CollapsibleSection } from "../visualization/index.js";
import { useColumnPriority, type ColumnDef } from "../hooks/index.js";

interface ConfigSurfaceViewProps {
  data: LoadedData;
  navigateTo?: NavigateTo;
  onSelect?: (detail: DetailItem | null) => void;
  /** When true, omit the standalone view header (used when embedded in Explorer). */
  embedded?: boolean;
}

type FilterType = "all" | "env" | "config" | "constant";

const TYPE_LABELS: Record<string, string> = {
  env: "Environment Variables",
  config: "Config File References",
  constant: "Global Constants",
};

const TYPE_ICONS: Record<string, string> = {
  env: "\u{2699}\u{FE0F}",  // ⚙️
  config: "\u{1F4C4}",       // 📄
  constant: "\u{1F310}",     // 🌐
};

function buildFileToZoneMap(zones: Zone[]): Map<string, { id: string; name: string }> {
  const map = new Map<string, { id: string; name: string }>();
  for (const zone of zones) {
    for (const file of zone.files) {
      map.set(file, { id: zone.id, name: zone.name });
    }
  }
  return map;
}

export function ConfigSurfaceView({ data, navigateTo, onSelect, embedded }: ConfigSurfaceViewProps) {
  const { configSurface, zones } = data;
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [zoneFilter, setZoneFilter] = useState("all");

  const fileToZone = useMemo(() => {
    if (!zones) return new Map<string, { id: string; name: string }>();
    return buildFileToZoneMap(zones.zones);
  }, [zones]);

  if (!configSurface) {
    return h("div", { class: "locked-view" },
      h("div", { class: "locked-icon" }, "\u{1F512}"),
      h("h2", null, "Configuration Surface"),
      h("p", null, "No config surface data available. Run 'sourcevision analyze' to scan for environment variables, config files, and constants."),
    );
  }

  const { entries, summary } = configSurface;

  // ── Column-priority system ──────────────────────────────────────
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const configColumns = useMemo<ColumnDef[]>(() => [
    { key: "name", label: "Name", priority: 10, minWidth: 120 },
    { key: "type", label: "Type", priority: 9, minWidth: 80 },
    { key: "file", label: "File", priority: 8, minWidth: 90 },
    { key: "zone", label: "Zone", priority: 7, minWidth: 80 },
    { key: "value", label: "Value", priority: 6, minWidth: 100 },
    { key: "line", label: "Line", priority: 5, minWidth: 60 },
  ], []);

  const {
    visibleKeys: cfgVisibleKeys,
    hiddenColumns: cfgHiddenColumns,
    hasHiddenColumns: cfgHasHidden,
    swapColumn: cfgSwapColumn,
    resetSwaps: cfgResetSwaps,
  } = useColumnPriority(tableContainerRef, configColumns);

  const cfgShow = (key: string) => cfgVisibleKeys.has(key);

  // Build list of zones referenced by config entries for the zone filter dropdown
  const zoneList = useMemo(() => {
    if (!zones) return [] as Array<{ id: string; name: string }>;
    const referencedIds = new Set<string>();
    for (const entry of entries) {
      for (const zoneId of entry.referencedBy) referencedIds.add(zoneId);
      // Also include zones derived from file mapping
      const z = fileToZone.get(entry.file);
      if (z) referencedIds.add(z.id);
    }
    return zones.zones
      .filter((z) => referencedIds.has(z.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [zones, entries, fileToZone]);

  const filtered = useMemo(() => {
    let result = entries;
    if (filterType !== "all") {
      result = result.filter((e) => e.type === filterType);
    }
    if (zoneFilter !== "all") {
      result = result.filter((e) => {
        if (zoneFilter === "__unzoned__") {
          const z = fileToZone.get(e.file);
          return !z && e.referencedBy.length === 0;
        }
        const z = fileToZone.get(e.file);
        return (z && z.id === zoneFilter) || e.referencedBy.includes(zoneFilter);
      });
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.file.toLowerCase().includes(q) ||
          (e.value && e.value.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [entries, filterType, zoneFilter, search, fileToZone]);

  // Group by zone for the zone attribution section
  const byZone = useMemo(() => {
    const map = new Map<string, ConfigSurfaceEntry[]>();
    for (const entry of entries) {
      for (const zoneId of entry.referencedBy) {
        let list = map.get(zoneId);
        if (!list) {
          list = [];
          map.set(zoneId, list);
        }
        list.push(entry);
      }
    }
    return map;
  }, [entries]);

  const handleFileClick = (file: string, line: number) => {
    if (!onSelect) return;
    const zone = fileToZone.get(file);
    onSelect({
      type: "file",
      title: file.split("/").pop() ?? file,
      path: file,
      zone: zone?.name,
    });
  };

  const handleZoneClick = (zoneId: string) => {
    if (navigateTo) {
      navigateTo("zones", { zone: zoneId });
    }
  };

  return h("div", { class: "config-surface-view" },
    // Header (omitted when embedded in Explorer Properties tab)
    !embedded
      ? h("div", { class: "view-header" },
          h(BrandedHeader, { product: "sourcevision", title: "SourceVision" }),
          h("h2", { class: "section-header" }, "Configuration Surface"),
        )
      : null,

    // Summary panels
    h("div", { class: "config-summary-panels" },
      h("div", { class: "config-summary-panel" },
        h("span", { class: "config-summary-icon" }, "\u{2699}\u{FE0F}"),
        h("span", { class: "config-summary-count" }, String(summary.totalEnvVars)),
        h("span", { class: "config-summary-label" }, "Env Variables"),
      ),
      h("div", { class: "config-summary-panel" },
        h("span", { class: "config-summary-icon" }, "\u{1F4C4}"),
        h("span", { class: "config-summary-count" }, String(summary.totalConfigRefs)),
        h("span", { class: "config-summary-label" }, "Config References"),
      ),
      h("div", { class: "config-summary-panel" },
        h("span", { class: "config-summary-icon" }, "\u{1F310}"),
        h("span", { class: "config-summary-count" }, String(summary.totalConstants)),
        h("span", { class: "config-summary-label" }, "Global Constants"),
      ),
    ),

    // Explorer-style filter bar
    h("div", { class: "filter-bar" },
      h("input", {
        class: "filter-input",
        type: "text",
        placeholder: "Search by name, file, or value...",
        value: search,
        onInput: (e: Event) => setSearch((e.target as HTMLInputElement).value),
      }),
      h("select", {
        class: "filter-select",
        value: filterType,
        onChange: (e: Event) => setFilterType((e.target as HTMLSelectElement).value as FilterType),
      },
        h("option", { value: "all" }, "All Types"),
        h("option", { value: "env" }, `\u{2699}\u{FE0F} ${TYPE_LABELS.env}`),
        h("option", { value: "config" }, `\u{1F4C4} ${TYPE_LABELS.config}`),
        h("option", { value: "constant" }, `\u{1F310} ${TYPE_LABELS.constant}`),
      ),
      zoneList.length > 0
        ? h("select", {
            class: "filter-select",
            value: zoneFilter,
            onChange: (e: Event) => setZoneFilter((e.target as HTMLSelectElement).value),
          },
            h("option", { value: "all" }, "All Zones"),
            zoneList.map((z) => h("option", { key: z.id, value: z.id }, z.name)),
            h("option", { value: "__unzoned__" }, "Unzoned"),
          )
        : null,
      cfgHasHidden
        ? h(ColumnSwitcher, {
            columns: configColumns,
            visibleKeys: cfgVisibleKeys,
            hiddenColumns: cfgHiddenColumns,
            onSwap: cfgSwapColumn,
            onReset: cfgResetSwaps,
          })
        : null,
      h("span", { class: "filter-result-count" },
        `Showing ${Math.min(200, filtered.length)} of ${entries.length} entries`,
      ),
    ),

    // Entries table
    h(CollapsibleSection, { title: `Entries (${filtered.length})`, defaultOpen: true },
      filtered.length === 0
        ? h("p", { class: "no-results" }, "No entries match the current filter.")
        : h("div", { ref: tableContainerRef },
            h("table", { class: "config-table" },
              h("thead", null,
                h("tr", null,
                  cfgShow("type") ? h("th", null, "Type") : null,
                  cfgShow("name") ? h("th", null, "Name") : null,
                  cfgShow("file") ? h("th", null, "File") : null,
                  cfgShow("line") ? h("th", null, "Line") : null,
                  cfgShow("zone") ? h("th", null, "Zone") : null,
                  cfgShow("value") ? h("th", null, "Value") : null,
                ),
              ),
              h("tbody", null,
                filtered.slice(0, 200).map((entry) => {
                  const zone = fileToZone.get(entry.file);
                  return h("tr", { key: `${entry.type}-${entry.name}-${entry.file}-${entry.line}` },
                    cfgShow("type")
                      ? h("td", null,
                          h("span", { class: `config-type-badge config-type-${entry.type}`, title: TYPE_LABELS[entry.type] },
                            TYPE_ICONS[entry.type] ?? "", " ", entry.type,
                          ),
                        )
                      : null,
                    cfgShow("name") ? h("td", { class: "config-name" }, entry.name) : null,
                    cfgShow("file")
                      ? h("td", null,
                          h("a", {
                            class: "file-link",
                            href: "#",
                            onClick: (e: Event) => {
                              e.preventDefault();
                              handleFileClick(entry.file, entry.line);
                            },
                          }, entry.file.split("/").pop()),
                        )
                      : null,
                    cfgShow("line") ? h("td", { class: "config-line" }, String(entry.line)) : null,
                    cfgShow("zone")
                      ? h("td", null,
                          zone
                            ? h("a", {
                                class: "zone-badge-link",
                                href: "#",
                                onClick: (e: Event) => {
                                  e.preventDefault();
                                  handleZoneClick(zone.id);
                                },
                              }, zone.name)
                            : h("span", { class: "text-dim" }, "\u2014"),
                        )
                      : null,
                    cfgShow("value")
                      ? h("td", { class: "config-value" },
                          entry.value !== undefined
                            ? h("code", null, entry.value.length > 40 ? entry.value.slice(0, 37) + "..." : entry.value)
                            : h("span", { class: "text-dim" }, "\u2014"),
                        )
                      : null,
                  );
                }),
                filtered.length > 200
                  ? h("tr", null,
                      h("td", { colSpan: cfgVisibleKeys.size, class: "text-dim" },
                        `... and ${filtered.length - 200} more entries`,
                      ),
                    )
                  : null,
              ),
            ),
          ),
    ),

    // Zone Attribution
    byZone.size > 0
      ? h(CollapsibleSection, { title: `Zone Attribution (${byZone.size} zones)`, defaultOpen: false },
          h("div", { class: "zone-attribution-list" },
            [...byZone.entries()]
              .sort((a, b) => b[1].length - a[1].length)
              .slice(0, 20)
              .map(([zoneId, zoneEntries]) => {
                const zoneName = zones?.zones.find((z) => z.id === zoneId)?.name ?? zoneId;
                const envCount = zoneEntries.filter((e) => e.type === "env").length;
                const constCount = zoneEntries.filter((e) => e.type === "constant").length;
                const configCount = zoneEntries.filter((e) => e.type === "config").length;

                return h("div", { class: "zone-attribution-item", key: zoneId },
                  h("div", { class: "zone-attribution-header" },
                    h("a", {
                      class: "zone-badge-link",
                      href: "#",
                      onClick: (e: Event) => {
                        e.preventDefault();
                        handleZoneClick(zoneId);
                      },
                    }, zoneName),
                    h("span", { class: "zone-attribution-count" },
                      `${zoneEntries.length} entries`,
                    ),
                  ),
                  h("div", { class: "zone-attribution-breakdown" },
                    envCount > 0 ? h("span", { class: "config-type-env" }, `${envCount} env`) : null,
                    constCount > 0 ? h("span", { class: "config-type-constant" }, `${constCount} const`) : null,
                    configCount > 0 ? h("span", { class: "config-type-config" }, `${configCount} config`) : null,
                  ),
                );
              }),
          ),
        )
      : null,
  );
}
