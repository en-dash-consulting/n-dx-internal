/**
 * Configuration Surface view — displays env vars, config file references,
 * and global constants with zone attribution.
 */

import { h } from "preact";
import { useState, useMemo } from "preact/hooks";
import type { LoadedData, NavigateTo, DetailItem } from "../types.js";
import type { ConfigSurfaceEntry, Zone } from "../external.js";
import { SearchFilter } from "../components/search-filter.js";
import { BrandedHeader } from "../components/logos.js";
import { CollapsibleSection } from "../visualization/index.js";

interface ConfigSurfaceViewProps {
  data: LoadedData;
  navigateTo?: NavigateTo;
  onSelect?: (detail: DetailItem | null) => void;
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

export function ConfigSurfaceView({ data, navigateTo, onSelect }: ConfigSurfaceViewProps) {
  const { configSurface, zones } = data;
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");

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

  const filtered = useMemo(() => {
    let result = entries;
    if (filterType !== "all") {
      result = result.filter((e) => e.type === filterType);
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
  }, [entries, filterType, search]);

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
    // Header
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision" }),
      h("h2", { class: "section-header" }, "Configuration Surface"),
    ),

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

    // Filters
    h("div", { class: "config-filters" },
      h(SearchFilter, { value: search, onInput: setSearch, placeholder: "Search by name, file, or value..." }),
      h("div", { class: "config-type-filters" },
        (["all", "env", "config", "constant"] as FilterType[]).map((t) =>
          h("button", {
            class: `filter-btn ${filterType === t ? "active" : ""}`,
            onClick: () => setFilterType(t),
          }, t === "all" ? "All" : TYPE_LABELS[t]),
        ),
      ),
    ),

    // Entries table
    h(CollapsibleSection, { title: `Entries (${filtered.length})`, defaultOpen: true },
      filtered.length === 0
        ? h("p", { class: "no-results" }, "No entries match the current filter.")
        : h("table", { class: "config-table" },
            h("thead", null,
              h("tr", null,
                h("th", null, "Type"),
                h("th", null, "Name"),
                h("th", null, "File"),
                h("th", null, "Line"),
                h("th", null, "Zone"),
                h("th", null, "Value"),
              ),
            ),
            h("tbody", null,
              filtered.slice(0, 200).map((entry) => {
                const zone = fileToZone.get(entry.file);
                return h("tr", { key: `${entry.type}-${entry.name}-${entry.file}-${entry.line}` },
                  h("td", null,
                    h("span", { class: `config-type-badge config-type-${entry.type}`, title: TYPE_LABELS[entry.type] },
                      TYPE_ICONS[entry.type] ?? "", " ", entry.type,
                    ),
                  ),
                  h("td", { class: "config-name" }, entry.name),
                  h("td", null,
                    h("a", {
                      class: "file-link",
                      href: "#",
                      onClick: (e: Event) => {
                        e.preventDefault();
                        handleFileClick(entry.file, entry.line);
                      },
                    }, entry.file.split("/").pop()),
                  ),
                  h("td", { class: "config-line" }, String(entry.line)),
                  h("td", null,
                    zone
                      ? h("a", {
                          class: "zone-badge-link",
                          href: "#",
                          onClick: (e: Event) => {
                            e.preventDefault();
                            handleZoneClick(zone.id);
                          },
                        }, zone.name)
                      : h("span", { class: "text-dim" }, "—"),
                  ),
                  h("td", { class: "config-value" },
                    entry.value !== undefined
                      ? h("code", null, entry.value.length > 40 ? entry.value.slice(0, 37) + "..." : entry.value)
                      : h("span", { class: "text-dim" }, "—"),
                  ),
                );
              }),
              filtered.length > 200
                ? h("tr", null,
                    h("td", { colSpan: 6, class: "text-dim" },
                      `... and ${filtered.length - 200} more entries`,
                    ),
                  )
                : null,
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
