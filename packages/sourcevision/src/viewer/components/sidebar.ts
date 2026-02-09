import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import type { Manifest, Zones } from "../../schema/v1.js";
import type { ViewId } from "../types.js";
import { ENRICHMENT_THRESHOLDS } from "./constants.js";

const LOGO_SRC = "./SourceVision-F.png";
const STORAGE_KEY = "sidebar-expanded-section";

interface SidebarProps {
  view: ViewId;
  onNavigate: (view: ViewId) => void;
  manifest: Manifest | null;
  zones: Zones | null;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

type NavItem = { type: "item"; id: ViewId; icon: string; label: string; minPass: number };
type NavSection = { type: "section"; label: string };
type NavEntry = NavItem | NavSection;

interface SectionGroup {
  label: string;
  items: NavItem[];
}

const NAV_ENTRIES: NavEntry[] = [
  { type: "section", label: "SOURCEVISION" },
  { type: "item", id: "overview", icon: "\u25A3", label: "Overview", minPass: 0 },
  { type: "item", id: "graph", icon: "\u2B95", label: "Import Graph", minPass: 0 },
  { type: "item", id: "zones", icon: "\u2B22", label: "Zones", minPass: 0 },
  { type: "item", id: "files", icon: "\u2630", label: "Files", minPass: 0 },
  { type: "item", id: "routes", icon: "\u25C7", label: "Routes", minPass: 0 },
  { type: "item", id: "architecture", icon: "\u25E8", label: "Architecture", minPass: ENRICHMENT_THRESHOLDS.architecture },
  { type: "item", id: "problems", icon: "\u26A0", label: "Problems", minPass: ENRICHMENT_THRESHOLDS.problems },
  { type: "item", id: "suggestions", icon: "\u2728", label: "Suggestions", minPass: ENRICHMENT_THRESHOLDS.suggestions },
  { type: "section", label: "REX" },
  { type: "item", id: "rex-dashboard", icon: "\u25A8", label: "Dashboard", minPass: 0 },
  { type: "item", id: "prd", icon: "\u2611", label: "Tasks", minPass: 0 },
  { type: "item", id: "rex-analysis", icon: "\u2699", label: "Analysis", minPass: 0 },
  { type: "item", id: "validation", icon: "\u2714", label: "Validation", minPass: 0 },
  { type: "item", id: "token-usage", icon: "\u229A", label: "Token Usage", minPass: 0 },
  { type: "section", label: "HENCH" },
  { type: "item", id: "hench-runs", icon: "\u25B6", label: "Runs", minPass: 0 },
];

/** Group flat NAV_ENTRIES into sections with their items */
function buildSections(): SectionGroup[] {
  const sections: SectionGroup[] = [];
  let current: SectionGroup | null = null;
  for (const entry of NAV_ENTRIES) {
    if (entry.type === "section") {
      current = { label: entry.label, items: [] };
      sections.push(current);
    } else if (current) {
      current.items.push(entry);
    }
  }
  return sections;
}

const SECTIONS = buildSections();

/** Find which section label owns the given view */
function sectionForView(view: ViewId): string {
  for (const section of SECTIONS) {
    if (section.items.some((item) => item.id === view)) {
      return section.label;
    }
  }
  return SECTIONS[0].label;
}

/** Read persisted expanded section, falling back to the section owning the active view */
function getInitialExpanded(view: ViewId): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SECTIONS.some((s) => s.label === stored)) return stored;
  } catch {
    // localStorage may be unavailable
  }
  return sectionForView(view);
}

export function Sidebar({ view, onNavigate, manifest, zones, sidebarCollapsed, onToggleSidebar }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string>(() => getInitialExpanded(view));

  const gitInfo = manifest
    ? [manifest.gitBranch, manifest.gitSha?.slice(0, 7)].filter(Boolean).join(" @ ")
    : null;

  const enrichmentPass = zones?.enrichmentPass ?? 0;

  const modules = manifest?.modules ?? {};
  const moduleNames = ["inventory", "imports", "zones", "components"];
  const completedCount = moduleNames.filter(
    (m) => modules[m]?.status === "complete"
  ).length;

  const handleNav = useCallback((id: ViewId) => {
    onNavigate(id);
    setMobileOpen(false);
  }, [onNavigate]);

  const toggleSection = useCallback((label: string) => {
    setExpandedSection((prev) => {
      const next = prev === label ? "" : label;
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* noop */ }
      return next;
    });
  }, []);

  // When the active view changes to a different section, auto-expand that section
  const prevViewRef = useRef(view);
  useEffect(() => {
    if (prevViewRef.current === view) return;
    prevViewRef.current = view;
    const owning = sectionForView(view);
    setExpandedSection((prev) => {
      if (prev === owning) return prev;
      try { localStorage.setItem(STORAGE_KEY, owning); } catch { /* noop */ }
      return owning;
    });
  }, [view]);

  // Global keyboard shortcut: Cmd/Ctrl + B to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        onToggleSidebar();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onToggleSidebar]);

  // Close mobile sidebar on backdrop click / Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [mobileOpen]);

  return h("div", {
    class: `sidebar${mobileOpen ? " mobile-open" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}`,
    role: "navigation",
    "aria-label": "Main navigation",
  },
    // Sidebar toggle button (always visible, anchored at top)
    h("button", {
      class: "sidebar-toggle-btn",
      onClick: onToggleSidebar,
      "aria-label": sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar",
      title: `${sidebarCollapsed ? "Expand" : "Collapse"} sidebar (\u2318B)`,
    }, sidebarCollapsed ? "\u25B6" : "\u25C0"),

    h("div", { class: "sidebar-header" },
      h("div", { class: "flex-row" },
        h("img", { src: LOGO_SRC, class: "sidebar-logo", alt: "n-dx" }),
        h("h1", null, "n-dx"),
      ),
      manifest
        ? h("div", { class: "meta" },
            gitInfo || manifest.targetPath.split("/").pop()
          )
        : null,
      h("button", {
        class: "mobile-menu-btn",
        onClick: () => setMobileOpen(!mobileOpen),
        "aria-label": mobileOpen ? "Close menu" : "Open menu",
        "aria-expanded": String(mobileOpen),
      }, mobileOpen ? "\u2715" : "\u2630")
    ),
    h("nav", { class: "sidebar-nav", "aria-label": "View navigation" },
      SECTIONS.map((section) => {
        const isExpanded = expandedSection === section.label;
        return h("div", { key: section.label, class: "nav-section" },
          // Section header (clickable)
          h("div", {
            class: "nav-section-header",
            role: "button",
            tabIndex: 0,
            "aria-expanded": String(isExpanded),
            "aria-controls": `nav-section-${section.label}`,
            onClick: () => toggleSection(section.label),
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleSection(section.label);
              }
            },
          },
            h("span", {
              class: `nav-section-chevron${isExpanded ? " nav-section-chevron-open" : ""}`,
              "aria-hidden": "true",
            }, "\u25B8"),
            h("span", { class: "nav-section-label" }, section.label),
          ),
          // Section items (collapsible)
          h("div", {
            id: `nav-section-${section.label}`,
            class: `nav-section-items${isExpanded ? "" : " nav-section-items-collapsed"}`,
            role: "group",
            "aria-label": `${section.label} views`,
          },
            section.items.map((entry) => {
              const locked = entry.minPass > 0 && enrichmentPass < entry.minPass;
              return h("div", {
                key: entry.id,
                class: `nav-item ${view === entry.id ? "active" : ""} ${locked ? "locked" : ""}`,
                onClick: locked ? undefined : () => handleNav(entry.id),
                role: "button",
                tabIndex: locked || !isExpanded ? -1 : 0,
                "aria-current": view === entry.id ? "page" : undefined,
                "aria-disabled": locked ? "true" : undefined,
                onKeyDown: (e: KeyboardEvent) => {
                  if (!locked && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    handleNav(entry.id);
                  }
                },
              },
                h("span", { class: "nav-icon", "aria-hidden": "true" }, entry.icon),
                entry.label,
                locked
                  ? h("span", { class: "nav-badge" }, `P${entry.minPass}`)
                  : null
              );
            })
          )
        );
      })
    ),
    manifest
      ? h("div", { class: "sidebar-progress", "aria-label": `Analysis progress: ${completedCount} of ${moduleNames.length} complete` },
          h("div", { class: "progress-label" }, `Analysis: ${completedCount}/${moduleNames.length}`),
          h("div", { class: "progress-bar", role: "progressbar", "aria-valuenow": String(completedCount), "aria-valuemin": "0", "aria-valuemax": String(moduleNames.length) },
            h("div", {
              class: "progress-fill",
              style: `width: ${(completedCount / moduleNames.length) * 100}%`,
            })
          ),
          h("div", { class: "progress-modules" },
            moduleNames.map((m) => {
              const status = modules[m]?.status;
              const icon = status === "complete" ? "\u2713" : status === "error" ? "\u2717" : "\u25CB";
              const cls = status === "complete" ? "done" : status === "error" ? "error" : "";
              return h("span", { key: m, class: `progress-module ${cls}`, title: m }, icon);
            })
          ),
        )
      : null,
    // Mobile backdrop
    mobileOpen
      ? h("div", {
          class: "sidebar-backdrop",
          onClick: () => setMobileOpen(false),
          "aria-hidden": "true",
        })
      : null
  );
}
