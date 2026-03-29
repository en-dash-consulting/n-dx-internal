/**
 * Unified Explorer view — consolidates Files and Import Graph.
 *
 * Merges the file list (inventory, classifications, zones) with the import
 * graph into a single view. Users can toggle between file-list mode and a
 * split-panel mode that shows the import graph alongside the file list.
 * Selecting a file in the list highlights its import edges in the graph.
 */
import { h, Fragment } from "preact";
import { useEffect, useRef, useState, useMemo, useCallback } from "preact/hooks";
import type { LoadedData, NavigateTo, DetailItem } from "../types.js";
import type { FileEntry, FileClassification, CircularDependency } from "../external.js";
import { buildFileToZoneMap, buildZoneColorMap, getZoneColorByIndex } from "../visualization/index.js";
import { GraphRenderer, type GraphNode, type GraphLink, type ZoneInfo, type ImportEdgeType } from "../graph/renderer.js";
import { basename } from "../utils.js";
import { BrandedHeader } from "../components/logos.js";

// ── Types ───────────────────────────────────────────────────────────

/** Valid explorer sub-tab identifiers. */
export type ExplorerTabId = "files" | "functions" | "properties";

const EXPLORER_TABS: { id: ExplorerTabId; label: string; icon: string }[] = [
  { id: "files", label: "Files", icon: "\u2630" },
  { id: "functions", label: "Functions", icon: "\u0192" },
  { id: "properties", label: "Properties", icon: "\u2699" },
];

const VALID_TAB_IDS = new Set<string>(EXPLORER_TABS.map((t) => t.id));
const EXPLORER_TAB_KEY = "explorer-active-tab";

function resolveInitialTab(initialTab: string | null | undefined): ExplorerTabId {
  // 1. If URL provides a valid tab, use it
  if (initialTab && VALID_TAB_IDS.has(initialTab)) return initialTab as ExplorerTabId;
  // 2. Fall back to localStorage
  try {
    const stored = localStorage.getItem(EXPLORER_TAB_KEY);
    if (stored && VALID_TAB_IDS.has(stored)) return stored as ExplorerTabId;
  } catch { /* noop */ }
  // 3. Default to files
  return "files";
}

interface ExplorerViewProps {
  data: LoadedData;
  onSelect: (detail: DetailItem | null) => void;
  selectedFile?: string | null;
  setSelectedFile?: (file: string | null) => void;
  selectedZone?: string | null;
  navigateTo?: NavigateTo;
  isGraphDisabled?: boolean;
  /** When set, graph auto-opens in split mode and focuses on the given circular cycle paths. */
  focusCycle?: string[] | null;
  /** Initial sub-tab from URL (e.g. "files", "functions", "properties"). */
  initialTab?: string | null;
}

type ExplorerMode = "files" | "split";
type SortKey = "path" | "size" | "language" | "lineCount" | "role" | "category" | "archetype" | "confidence" | "lastModified";
type SortDir = "asc" | "desc";

/** Internal tool directories hidden from the file list by default */
const INTERNAL_DIR_PREFIXES = [".hench/", ".rex/", ".sourcevision/"];

const ROLE_TAG_CLASS: Record<string, string> = {
  source: "tag-source",
  test: "tag-test",
  config: "tag-config",
  docs: "tag-docs",
  generated: "tag-other",
  asset: "tag-other",
  build: "tag-other",
  other: "tag-other",
};

const GRAPH_VISIBLE_KEY = "explorer-graph-visible";
const EXPLORER_MODE_KEY = "explorer-mode";

function getInitialMode(): ExplorerMode {
  try {
    const stored = localStorage.getItem(EXPLORER_MODE_KEY);
    if (stored === "split") return "split";
  } catch { /* noop */ }
  return "files";
}

function getInitialGraphVisible(): boolean {
  try {
    return localStorage.getItem(GRAPH_VISIBLE_KEY) === "true";
  } catch {
    return false;
  }
}

// ── Component ────────────────────────────────────────────────────────

/** All possible import edge types for filter UI. */
const EDGE_TYPES: { key: ImportEdgeType; label: string }[] = [
  { key: "static", label: "Static" },
  { key: "dynamic", label: "Dynamic" },
  { key: "reexport", label: "Re-export" },
  { key: "type", label: "Type-only" },
  { key: "require", label: "Require" },
];

export function ExplorerView({
  data,
  onSelect,
  selectedFile,
  setSelectedFile,
  selectedZone,
  navigateTo,
  isGraphDisabled,
  focusCycle,
  initialTab,
}: ExplorerViewProps) {
  const { inventory, zones, classifications, imports } = data;

  // Active sub-tab
  const [activeTab, setActiveTab] = useState<ExplorerTabId>(() => resolveInitialTab(initialTab));
  const initialTabConsumedRef = useRef(false);

  // Sync URL on initial mount and when tab comes from URL
  useEffect(() => {
    if (initialTabConsumedRef.current) return;
    initialTabConsumedRef.current = true;
    const resolved = resolveInitialTab(initialTab);
    setActiveTab(resolved);
    // Always ensure URL reflects the active tab
    history.replaceState(
      { view: "explorer", file: null, zone: null, runId: null, taskId: null, explorerTab: resolved },
      "",
      `/explorer/${resolved}`,
    );
  }, [initialTab]);

  const handleTabChange = useCallback((tabId: ExplorerTabId) => {
    setActiveTab(tabId);
    try { localStorage.setItem(EXPLORER_TAB_KEY, tabId); } catch { /* noop */ }
    history.pushState(
      { view: "explorer", file: null, zone: null, runId: null, taskId: null, explorerTab: tabId },
      "",
      `/explorer/${tabId}`,
    );
  }, []);

  // Mode: files-only or split (files + graph)
  const [mode, setMode] = useState<ExplorerMode>(getInitialMode);

  // File list state
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [langFilter, setLangFilter] = useState<string>("all");
  const [zoneFilter, setZoneFilter] = useState<string>("all");
  const [archetypeFilter, setArchetypeFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("path");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showCount, setShowCount] = useState(100);
  const [showAllFiles, setShowAllFiles] = useState(false);

  // Graph state
  const svgRef = useRef<SVGSVGElement>(null);
  const graphRef = useRef<GraphRenderer | null>(null);
  const [graphInitialized, setGraphInitialized] = useState(false);
  const [graphSearch, setGraphSearch] = useState("");
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [zonesVisible, setZonesVisible] = useState(true);
  const [collapsedZones, setCollapsedZones] = useState<Set<string>>(new Set());
  const [graphVisible, setGraphVisible] = useState(getInitialGraphVisible);
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState<Set<ImportEdgeType>>(new Set());

  // Auto-set zone filter when selectedZone prop is provided
  useEffect(() => {
    if (selectedZone) {
      setZoneFilter(selectedZone);
    }
  }, [selectedZone]);

  // Persist mode to localStorage
  const handleModeChange = useCallback((newMode: ExplorerMode) => {
    setMode(newMode);
    try { localStorage.setItem(EXPLORER_MODE_KEY, newMode); } catch { /* noop */ }
    if (newMode === "files") {
      // Destroy graph when switching away from split mode
      graphRef.current?.destroy();
      graphRef.current = null;
      setGraphInitialized(false);
    }
  }, []);

  // ── File list data ────────────────────────────────────────────────

  const fileToZone = useMemo(() => buildFileToZoneMap(zones), [zones]);

  const fileToClassification = useMemo(() => {
    const map = new Map<string, FileClassification>();
    if (classifications) {
      for (const fc of classifications.files) {
        map.set(fc.path, fc);
      }
    }
    return map;
  }, [classifications]);

  const zoneList = useMemo(() => {
    if (!zones) return [];
    return zones.zones.map((z, i) => ({
      id: z.id,
      name: z.name,
      color: getZoneColorByIndex(i),
    }));
  }, [zones]);

  const languages = useMemo(
    () => inventory ? Object.keys(inventory.summary.byLanguage).sort() : [],
    [inventory]
  );

  const roles = useMemo(
    () => inventory ? Object.keys(inventory.summary.byRole).sort() : [],
    [inventory]
  );

  const archetypeList = useMemo(() => {
    if (!classifications) return [];
    return classifications.archetypes
      .map((a) => ({ id: a.id, name: a.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [classifications]);

  const hasClassifications = classifications !== null && classifications.files.length > 0;
  const hasLastModified = useMemo(
    () => inventory ? inventory.files.some((f) => f.lastModified != null) : false,
    [inventory]
  );

  const filtered = useMemo(() => {
    if (!inventory) return [];
    let files = inventory.files;

    if (!showAllFiles) {
      files = files.filter(
        (f) => !INTERNAL_DIR_PREFIXES.some((prefix) => f.path.startsWith(prefix))
      );
    }

    if (search) {
      const q = search.toLowerCase();
      files = files.filter(
        (f) =>
          f.path.toLowerCase().includes(q) ||
          f.category.toLowerCase().includes(q)
      );
    }

    if (roleFilter !== "all") {
      files = files.filter((f) => f.role === roleFilter);
    }

    if (langFilter !== "all") {
      files = files.filter((f) => f.language === langFilter);
    }

    if (zoneFilter !== "all") {
      if (zoneFilter === "__unzoned__") {
        files = files.filter((f) => !fileToZone.has(f.path));
      } else {
        files = files.filter((f) => fileToZone.get(f.path)?.id === zoneFilter);
      }
    }

    if (archetypeFilter !== "all") {
      if (archetypeFilter === "__unclassified__") {
        files = files.filter((f) => {
          const fc = fileToClassification.get(f.path);
          return !fc || fc.archetype === null;
        });
      } else {
        files = files.filter((f) => {
          const fc = fileToClassification.get(f.path);
          return fc?.archetype === archetypeFilter;
        });
      }
    }

    files = [...files].sort((a, b) => {
      let cmp: number;
      if (sortKey === "archetype") {
        const aArch = fileToClassification.get(a.path)?.archetype ?? "";
        const bArch = fileToClassification.get(b.path)?.archetype ?? "";
        cmp = aArch.localeCompare(bArch);
      } else if (sortKey === "confidence") {
        const aConf = fileToClassification.get(a.path)?.confidence ?? -1;
        const bConf = fileToClassification.get(b.path)?.confidence ?? -1;
        cmp = aConf - bConf;
      } else if (sortKey === "lastModified") {
        const aTime = a.lastModified ?? 0;
        const bTime = b.lastModified ?? 0;
        cmp = aTime - bTime;
      } else {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        cmp =
          typeof aVal === "number" && typeof bVal === "number"
            ? aVal - bVal
            : String(aVal).localeCompare(String(bVal));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return files;
  }, [inventory, search, roleFilter, langFilter, zoneFilter, archetypeFilter, sortKey, sortDir, fileToZone, fileToClassification, showAllFiles]);

  // Reset show count when filters change
  useMemo(() => setShowCount(100), [search, roleFilter, langFilter, zoneFilter, archetypeFilter, showAllFiles]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIndicator = (key: SortKey): string => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  };

  const handleRowClick = (file: FileEntry) => {
    if (setSelectedFile) setSelectedFile(file.path);
    const fc = fileToClassification.get(file.path);
    onSelect({
      type: "file",
      title: basename(file.path),
      path: file.path,
      language: file.language,
      size: formatSize(file.size),
      lines: file.lineCount,
      role: file.role,
      category: file.category,
      hash: file.hash,
      archetype: fc?.archetype ?? null,
      archetypeConfidence: fc?.confidence,
      archetypeSource: fc?.source,
    });

    // Highlight the selected file in the graph if in split mode
    if (mode === "split" && graphRef.current) {
      graphRef.current.highlightNode(file.path);
      graphRef.current.centerOnNode(file.path);
    }
  };

  // ── Graph data ────────────────────────────────────────────────────

  const fileToZoneMap = useMemo(() => {
    const map = new Map<string, string>();
    if (zones) {
      zones.zones.forEach((z) => {
        for (const f of z.files) map.set(f, z.id);
      });
    }
    return map;
  }, [zones]);

  const zoneColorMap = useMemo(() => buildZoneColorMap(zones), [zones]);

  const crossZoneSet = useMemo(() => {
    const set = new Set<string>();
    if (zones) {
      for (const c of zones.crossings) {
        set.add(`${c.from}\0${c.to}`);
      }
    }
    return set;
  }, [zones]);

  /** Build a set of "from\0to" keys for edges that participate in any circular dependency. */
  const circularEdgeSet = useMemo(() => {
    const set = new Set<string>();
    if (imports && imports.summary.circulars.length > 0) {
      for (const circ of imports.summary.circulars) {
        const cycle = circ.cycle;
        for (let i = 0; i < cycle.length; i++) {
          const from = cycle[i];
          const to = cycle[(i + 1) % cycle.length];
          set.add(`${from}\0${to}`);
        }
      }
    }
    return set;
  }, [imports]);

  const inventoryMap = useMemo(() => {
    const map = new Map<string, { language: string; size: number; lines: number; role: string; category: string }>();
    if (inventory) {
      for (const f of inventory.files) {
        map.set(f.path, {
          language: f.language,
          size: f.size,
          lines: f.lineCount,
          role: f.role,
          category: f.category,
        });
      }
    }
    return map;
  }, [inventory]);

  const zoneInfos = useMemo<ZoneInfo[]>(() => {
    if (!zones) return [];
    return zones.zones.map((z, i) => ({
      id: z.id,
      name: z.name,
      color: getZoneColorByIndex(i),
      files: z.files,
    }));
  }, [zones]);

  const handleNodeDblClick = useCallback((path: string) => {
    // Select file in file list
    if (setSelectedFile) setSelectedFile(path);
  }, [setSelectedFile]);

  const handleZoneSelect = useCallback((zoneId: string) => {
    if (!zones) return;
    const zone = zones.zones.find((z) => z.id === zoneId);
    if (!zone) return;
    onSelect({
      type: "zone",
      title: zone.name,
      id: zone.id,
      zoneId: zone.id,
      description: zone.description,
      files: zone.files.length,
      entryPoints: zone.entryPoints,
      cohesion: zone.cohesion.toFixed(2),
      coupling: zone.coupling.toFixed(2),
    });
  }, [zones, onSelect]);

  // Graph label/zone/zoom controls
  const handleToggleLabels = useCallback(() => {
    if (graphRef.current) {
      const visible = graphRef.current.toggleLabels();
      setLabelsVisible(visible);
    }
  }, []);

  const handleToggleZones = useCallback(() => {
    if (graphRef.current) {
      const visible = graphRef.current.toggleZones();
      setZonesVisible(visible);
    }
  }, []);

  const handleZoomIn = useCallback(() => { graphRef.current?.zoomIn(); }, []);
  const handleZoomOut = useCallback(() => { graphRef.current?.zoomOut(); }, []);
  const handleResetView = useCallback(() => { graphRef.current?.resetView(); }, []);

  const handleZoneLegendClick = useCallback((zoneId: string) => {
    if (!graphRef.current) return;
    const nowCollapsed = graphRef.current.toggleZoneCollapse(zoneId);
    setCollapsedZones((prev) => {
      const next = new Set(prev);
      if (nowCollapsed) next.add(zoneId);
      else next.delete(zoneId);
      return next;
    });
  }, []);

  const handleToggleGraph = useCallback(() => {
    setGraphVisible((prev) => {
      const next = !prev;
      try { localStorage.setItem(GRAPH_VISIBLE_KEY, String(next)); } catch { /* noop */ }
      if (!next) {
        graphRef.current?.destroy();
        graphRef.current = null;
        setGraphInitialized(false);
      }
      return next;
    });
  }, []);

  // Init graph when in split mode and visible
  useEffect(() => {
    if (mode !== "split" || !graphVisible || !svgRef.current || !imports || graphInitialized) return;

    const svg = svgRef.current;
    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 600;

    const nodeSet = new Set<string>();
    for (const e of imports.edges) {
      nodeSet.add(e.from);
      nodeSet.add(e.to);
    }

    const importCounts = new Map<string, number>();
    for (const e of imports.edges) {
      importCounts.set(e.to, (importCounts.get(e.to) || 0) + 1);
    }

    const nodes: GraphNode[] = Array.from(nodeSet).map((id) => ({
      id,
      zone: fileToZoneMap.get(id),
      zoneColor: fileToZoneMap.has(id) ? zoneColorMap.get(fileToZoneMap.get(id)!) : "var(--text-dim)",
      importCount: importCounts.get(id) || 0,
    }));

    const links: GraphLink[] = imports.edges.map((e) => ({
      source: e.from,
      target: e.to,
      crossZone: crossZoneSet.has(`${e.from}\0${e.to}`),
      importType: e.type as ImportEdgeType,
      circular: circularEdgeSet.has(`${e.from}\0${e.to}`),
    }));

    const renderer = new GraphRenderer({
      svg, nodes, links, width, height,
      onNodeSelect: (detail) => {
        const inv = inventoryMap.get(detail.path);
        const enriched: DetailItem = {
          type: "file",
          ...detail,
          ...(inv ? {
            language: inv.language,
            size: formatSize(inv.size),
            lines: inv.lines,
            role: inv.role,
            category: inv.category,
          } : {}),
        };
        onSelect(enriched);
        if (setSelectedFile) setSelectedFile(detail.path);
      },
      onNodeDblClick: handleNodeDblClick,
      onZoneSelect: handleZoneSelect,
      zoneInfos,
    });
    graphRef.current = renderer;
    setGraphInitialized(true);

    return () => {
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, [mode, imports, graphInitialized, graphVisible, circularEdgeSet]);

  // Highlight selected file in graph
  useEffect(() => {
    if (graphRef.current && selectedFile) {
      graphRef.current.highlightNode(selectedFile);
      graphRef.current.centerOnNode(selectedFile);
    }
  }, [selectedFile]);

  // Handle graph search
  useEffect(() => {
    if (!graphRef.current || !graphSearch) {
      if (graphRef.current) graphRef.current.highlightNode(null);
      return;
    }
    const q = graphSearch.toLowerCase();
    const match = graphRef.current.nodes.find((n) =>
      n.id.toLowerCase().includes(q)
    );
    if (match) {
      graphRef.current.highlightNode(match.id);
      graphRef.current.centerOnNode(match.id);
    }
  }, [graphSearch]);

  // Focus on a circular dependency cycle when focusCycle prop is set
  useEffect(() => {
    if (!focusCycle || focusCycle.length === 0) return;
    // Auto-switch to split mode and enable graph
    if (mode !== "split") handleModeChange("split");
    if (!graphVisible) {
      setGraphVisible(true);
      try { localStorage.setItem(GRAPH_VISIBLE_KEY, "true"); } catch { /* noop */ }
    }
  }, [focusCycle]);

  // Apply focus cycle after graph is initialized
  useEffect(() => {
    if (graphRef.current && focusCycle && focusCycle.length > 0 && graphInitialized) {
      // Short delay to allow layout to settle
      const timer = setTimeout(() => {
        graphRef.current?.focusOnPaths(focusCycle);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [focusCycle, graphInitialized]);

  // Apply edge type filter
  useEffect(() => {
    if (graphRef.current) {
      graphRef.current.filterEdgeTypes(hiddenEdgeTypes);
    }
  }, [hiddenEdgeTypes, graphInitialized]);

  const handleToggleEdgeType = useCallback((type: ImportEdgeType) => {
    setHiddenEdgeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // Cleanup graph on unmount
  useEffect(() => {
    return () => {
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, []);

  const legendItems = useMemo(() => {
    if (!zones) return [];
    return zones.zones.map((z, i) => ({
      id: z.id,
      name: z.name,
      color: getZoneColorByIndex(i),
    }));
  }, [zones]);

  if (!inventory) {
    return h("div", { class: "loading" }, "No inventory data available.");
  }

  const nodeCount = imports
    ? new Set([...imports.edges.map((e) => e.from), ...imports.edges.map((e) => e.to)]).size
    : 0;
  const hasImports = imports !== null && imports.edges.length > 0;
  const visible = filtered.slice(0, showCount);
  const remaining = filtered.length - showCount;

  return h("div", { class: "explorer-view" },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Explorer"),
    ),

    // Sub-tab bar
    h("div", { class: "explorer-tab-bar", role: "tablist", "aria-label": "Explorer sections" },
      EXPLORER_TABS.map((tab) =>
        h("button", {
          key: tab.id,
          class: `explorer-tab${activeTab === tab.id ? " explorer-tab-active" : ""}`,
          role: "tab",
          "aria-selected": String(activeTab === tab.id),
          "aria-controls": `explorer-panel-${tab.id}`,
          onClick: () => handleTabChange(tab.id),
        }, `${tab.icon} ${tab.label}`)
      ),
    ),

    // Tab panel wrapper
    h("div", {
      role: "tabpanel",
      id: `explorer-panel-${activeTab}`,
      "aria-labelledby": `explorer-tab-${activeTab}`,
    },
      activeTab === "files" ? h(Fragment, null,
        h("p", { class: "section-sub" },
          `${inventory.summary.totalFiles} files, ${inventory.summary.totalLines.toLocaleString()} lines`,
          hasImports ? ` \u2022 ${imports!.edges.length} import edges between ${nodeCount} files` : "",
          hasImports && imports!.summary.avgImportsPerFile > 0
            ? ` \u2022 ${imports!.summary.avgImportsPerFile} avg imports/file`
            : "",
          hasImports && imports!.summary.circularCount > 0
            ? ` \u2022 ${imports!.summary.circularCount} circular`
            : "",
        ),

    // Mode toggle bar
    h("div", { class: "explorer-mode-bar" },
      h("button", {
        class: `explorer-mode-btn${mode === "files" ? " active" : ""}`,
        onClick: () => handleModeChange("files"),
        "aria-pressed": String(mode === "files"),
      }, "\u2630 Files"),
      hasImports && !isGraphDisabled
        ? h("button", {
            class: `explorer-mode-btn${mode === "split" ? " active" : ""}`,
            onClick: () => handleModeChange("split"),
            "aria-pressed": String(mode === "split"),
          }, "\u2B95 Files + Graph")
        : null,
    ),

    // Filter bar (shared across modes)
    h("div", { class: "filter-bar" },
      h("input", {
        class: "filter-input",
        type: "text",
        placeholder: "Search files or categories...",
        value: search,
        onInput: (e: Event) => setSearch((e.target as HTMLInputElement).value),
      }),
      h("select", {
        class: "filter-select",
        value: roleFilter,
        onChange: (e: Event) => setRoleFilter((e.target as HTMLSelectElement).value),
      },
        h("option", { value: "all" }, "All Roles"),
        roles.map((r) => h("option", { key: r, value: r }, r))
      ),
      h("select", {
        class: "filter-select",
        value: langFilter,
        onChange: (e: Event) => setLangFilter((e.target as HTMLSelectElement).value),
      },
        h("option", { value: "all" }, "All Languages"),
        languages.map((l) => h("option", { key: l, value: l }, l))
      ),
      zoneList.length > 0
        ? h("select", {
            class: "filter-select",
            value: zoneFilter,
            onChange: (e: Event) => setZoneFilter((e.target as HTMLSelectElement).value),
          },
            h("option", { value: "all" }, "All Zones"),
            zoneList.map((z) => h("option", { key: z.id, value: z.id }, z.name)),
            h("option", { value: "__unzoned__" }, "Unzoned")
          )
        : null,
      archetypeList.length > 0
        ? h("select", {
            class: "filter-select",
            value: archetypeFilter,
            onChange: (e: Event) => setArchetypeFilter((e.target as HTMLSelectElement).value),
          },
            h("option", { value: "all" }, "All Archetypes"),
            archetypeList.map((a) => h("option", { key: a.id, value: a.id }, a.name)),
            h("option", { value: "__unclassified__" }, "Unclassified")
          )
        : null,
      h("button", {
        class: `filter-toggle-btn${showAllFiles ? " active" : ""}`,
        onClick: () => setShowAllFiles(!showAllFiles),
        title: showAllFiles ? "Hide internal tool directories" : "Show all files including internal directories",
        "aria-pressed": String(showAllFiles),
      }, showAllFiles ? "\u2713 All Files" : "Show All Files"),
      h("span", { class: "filter-result-count" },
        `Showing ${Math.min(showCount, filtered.length)} of ${filtered.length} files`
      ),
    ),

    // Content area
    mode === "split"
      ? // Split mode: file list + graph side by side
        h("div", { class: "explorer-split" },
          h("div", { class: "explorer-split-files" },
            renderFileTable(visible, remaining, showCount, setShowCount, zoneList, hasClassifications, hasLastModified, fileToZone, fileToClassification, sortIndicator, toggleSort, handleRowClick, selectedFile),
          ),
          h("div", { class: "explorer-split-graph" },
            // Graph visibility toggle
            h("div", { class: "graph-visibility-bar" },
              h("button", {
                class: `filter-toggle-btn${graphVisible ? " active" : ""}`,
                onClick: handleToggleGraph,
                "aria-pressed": String(graphVisible),
                title: graphVisible ? "Hide graph visualization" : "Show graph visualization",
              }, graphVisible ? "\u2713 Graph Visible" : "Show Graph"),
              !graphVisible
                ? h("span", { class: "graph-visibility-hint" },
                    "Click to enable the force-directed graph."
                  )
                : null,
            ),
            graphVisible
              ? h(Fragment, null,
                  h("div", { class: "graph-search-bar" },
                    h("input", {
                      type: "text",
                      class: "filter-input",
                      placeholder: "Search nodes...",
                      value: graphSearch,
                      onInput: (e: Event) => setGraphSearch((e.target as HTMLInputElement).value),
                    }),
                  ),
                  // Edge type filter pills
                  h("div", { class: "edge-filter-bar" },
                    EDGE_TYPES.map((et) =>
                      h("button", {
                        key: et.key,
                        class: `edge-filter-pill${hiddenEdgeTypes.has(et.key) ? " hidden-type" : " active"}`,
                        onClick: () => handleToggleEdgeType(et.key),
                        title: hiddenEdgeTypes.has(et.key) ? `Show ${et.label} edges` : `Hide ${et.label} edges`,
                      }, et.label)
                    ),
                  ),
                  h("div", { class: "graph-container", style: "position: relative;" },
                    h("svg", { ref: svgRef }),
                    h("button", {
                      class: "graph-label-toggle",
                      onClick: handleToggleLabels,
                      title: labelsVisible ? "Hide labels" : "Show labels",
                    }, labelsVisible ? "Labels" : "Labels off"),
                    h("button", {
                      class: "graph-zone-toggle",
                      onClick: handleToggleZones,
                      title: zonesVisible ? "Hide zone groups" : "Show zone groups",
                    }, zonesVisible ? "Zones" : "Zones off"),
                    h("div", { class: "graph-zoom-controls" },
                      h("button", {
                        class: "graph-zoom-btn",
                        onClick: handleZoomIn,
                        title: "Zoom in",
                        "aria-label": "Zoom in",
                      }, "+"),
                      h("button", {
                        class: "graph-zoom-btn",
                        onClick: handleZoomOut,
                        title: "Zoom out",
                        "aria-label": "Zoom out",
                      }, "\u2212"),
                      h("button", {
                        class: "graph-zoom-btn graph-zoom-fit",
                        onClick: handleResetView,
                        title: "Fit to content",
                        "aria-label": "Fit to content",
                      }, "\u2922"),
                    ),
                    legendItems.length > 0
                      ? h("div", { class: "graph-legend" },
                          h("div", { class: "graph-legend-title", style: "font-size: 10px; color: var(--text-dim); margin-bottom: 4px; opacity: 0.7;" }, "Click to toggle zone"),
                          legendItems.map((item) =>
                            h("div", {
                              key: item.name,
                              class: `graph-legend-item${collapsedZones.has(item.id) ? " collapsed" : ""}`,
                              onClick: () => handleZoneLegendClick(item.id),
                            },
                              h("span", { class: "graph-legend-dot", style: `background: ${item.color};` }),
                              item.name
                            )
                          )
                        )
                      : null,
                    // Edge type legend
                    h("div", { class: "edge-legend" },
                      h("div", { class: "edge-legend-title" }, "Edge Types"),
                      h("div", {
                        class: `edge-legend-item${hiddenEdgeTypes.has("static") ? " hidden" : ""}`,
                        onClick: () => handleToggleEdgeType("static"),
                      },
                        h("span", { class: "edge-legend-line line-static" }),
                        "Static",
                      ),
                      h("div", {
                        class: `edge-legend-item${hiddenEdgeTypes.has("dynamic") ? " hidden" : ""}`,
                        onClick: () => handleToggleEdgeType("dynamic"),
                      },
                        h("span", { class: "edge-legend-line line-dynamic" }),
                        "Dynamic",
                      ),
                      h("div", {
                        class: `edge-legend-item${hiddenEdgeTypes.has("reexport") ? " hidden" : ""}`,
                        onClick: () => handleToggleEdgeType("reexport"),
                      },
                        h("span", { class: "edge-legend-line line-reexport" }),
                        "Re-export",
                      ),
                      h("div", {
                        class: `edge-legend-item${hiddenEdgeTypes.has("type") ? " hidden" : ""}`,
                        onClick: () => handleToggleEdgeType("type"),
                      },
                        h("span", { class: "edge-legend-line line-type" }),
                        "Type-only",
                      ),
                      h("div", {
                        class: `edge-legend-item${hiddenEdgeTypes.has("require") ? " hidden" : ""}`,
                        onClick: () => handleToggleEdgeType("require"),
                      },
                        h("span", { class: "edge-legend-line line-require" }),
                        "Require",
                      ),
                      imports && imports.summary.circularCount > 0
                        ? h("div", { class: "edge-legend-item" },
                            h("span", { class: "edge-legend-line line-circular" }),
                            "Circular",
                          )
                        : null,
                    ),
                  ),
                )
              : h("div", { class: "graph-hidden-placeholder" },
                  h("div", { class: "graph-hidden-icon" }, "\u2B95"),
                  h("div", { class: "graph-hidden-stats" },
                    h("span", { class: "stat-card" },
                      h("span", { class: "value" }, String(nodeCount)),
                      h("span", { class: "label" }, "Files"),
                    ),
                    h("span", { class: "stat-card" },
                      h("span", { class: "value" }, String(imports?.edges.length ?? 0)),
                      h("span", { class: "label" }, "Edges"),
                    ),
                    zones
                      ? h("span", { class: "stat-card" },
                          h("span", { class: "value" }, String(zones.zones.length)),
                          h("span", { class: "label" }, "Zones"),
                        )
                      : null,
                  ),
                ),
          ),
        )
      : // Files-only mode
        h("div", null,
          renderFileTable(visible, remaining, showCount, setShowCount, zoneList, hasClassifications, hasLastModified, fileToZone, fileToClassification, sortIndicator, toggleSort, handleRowClick, selectedFile),
        ),
      ) : activeTab === "functions" ? h("div", { class: "explorer-tab-placeholder" },
        h("p", { class: "section-sub" }, "Functions catalog — coming soon."),
      ) : activeTab === "properties" ? h("div", { class: "explorer-tab-placeholder" },
        h("p", { class: "section-sub" }, "Configuration properties — coming soon."),
      ) : null,
    ),
  );
}

// ── File table renderer (shared between modes) ──────────────────────

type ZoneEntry = { id: string; name: string; color: string };

function renderFileTable(
  visible: FileEntry[],
  remaining: number,
  showCount: number,
  setShowCount: (n: number) => void,
  zoneList: ZoneEntry[],
  hasClassifications: boolean,
  hasLastModified: boolean,
  fileToZone: Map<string, ZoneEntry>,
  fileToClassification: Map<string, FileClassification>,
  sortIndicator: (key: SortKey) => string,
  toggleSort: (key: SortKey) => void,
  handleRowClick: (file: FileEntry) => void,
  selectedFile: string | null | undefined,
) {
  return h(Fragment, null,
    h("div", { class: "data-table-wrapper" },
      h("table", { class: "data-table" },
        h("thead", null,
          h("tr", null,
            h("th", { onClick: () => toggleSort("path") }, `Path${sortIndicator("path")}`),
            zoneList.length > 0 ? h("th", null, "Zone") : null,
            h("th", { onClick: () => toggleSort("language") }, `Language${sortIndicator("language")}`),
            h("th", { onClick: () => toggleSort("lineCount") }, `Lines${sortIndicator("lineCount")}`),
            h("th", { onClick: () => toggleSort("size") }, `Size${sortIndicator("size")}`),
            h("th", { onClick: () => toggleSort("role") }, `Role${sortIndicator("role")}`),
            h("th", { onClick: () => toggleSort("category") }, `Category${sortIndicator("category")}`),
            hasLastModified
              ? h("th", { onClick: () => toggleSort("lastModified") }, `Modified${sortIndicator("lastModified")}`)
              : null,
            hasClassifications
              ? h("th", { onClick: () => toggleSort("archetype") }, `Archetype${sortIndicator("archetype")}`)
              : null,
            hasClassifications
              ? h("th", { onClick: () => toggleSort("confidence") }, `Confidence${sortIndicator("confidence")}`)
              : null,
          )
        ),
        h("tbody", null,
          visible.map((file) => {
            const fz = fileToZone.get(file.path);
            const fc = fileToClassification.get(file.path);
            const archetypeName = fc?.archetype ?? "unclassified";
            const isOverride = fc?.source === "user-override";
            return h("tr", {
              key: file.path,
              onClick: () => handleRowClick(file),
              style: `cursor: pointer;${selectedFile === file.path ? " background: var(--bg-hover);" : ""}`,
            },
              h("td", { class: "mono-sm" }, file.path),
              zoneList.length > 0
                ? h("td", null,
                    fz
                      ? h("span", { class: "zone-badge", style: `--zone-color: ${fz.color}` },
                          fz.name
                        )
                      : null
                  )
                : null,
              h("td", null, file.language),
              h("td", { class: "text-right" }, file.lineCount.toLocaleString()),
              h("td", { class: "text-right" }, formatSize(file.size)),
              h("td", null,
                h("span", { class: `tag ${ROLE_TAG_CLASS[file.role] || "tag-other"}` }, file.role)
              ),
              h("td", null, file.category),
              hasLastModified
                ? h("td", { class: "text-right" },
                    file.lastModified ? formatDate(file.lastModified) : "\u2014"
                  )
                : null,
              hasClassifications
                ? h("td", null,
                    h("span", {
                      class: `tag ${isOverride ? "tag-override" : "tag-archetype"}`,
                      title: isOverride ? "User override" : fc?.source ?? "unclassified",
                    },
                      isOverride ? `\u270E ${archetypeName}` : archetypeName
                    )
                  )
                : null,
              hasClassifications
                ? h("td", { class: "text-right" },
                    fc ? fc.confidence.toFixed(2) : "\u2014"
                  )
                : null,
            );
          })
        )
      )
    ),

    remaining > 0
      ? h("div", { class: "empty-state" },
          h("button", {
            class: "collapsible-toggle",
            onClick: () => setShowCount(showCount + 100),
          }, `Show ${Math.min(remaining, 100)} more (${remaining} remaining)`)
        )
      : null,
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  const now = Date.now();
  const diffMs = now - epochMs;
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
