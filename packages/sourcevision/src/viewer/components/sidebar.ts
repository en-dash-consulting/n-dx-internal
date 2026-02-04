import { h } from "preact";
import { useState } from "preact/hooks";
import type { Manifest, Zones } from "../../schema/v1.js";
import type { ViewId } from "../types.js";
import { ENRICHMENT_THRESHOLDS } from "./constants.js";

const LOGO_DARK = "data:image/png;base64,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NggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANggsADb6QmLv/9fVAACtSB5YX/71/QAArWBICMAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcBG8t0ahn/7zQAAreg5c/iL+QAABhgSArBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGw8We6zCC+TuJBVQAAAABJRU5ErkJggg==";
const LOGO_LIGHT = "data:image/png;base64,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ANggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANggsADYILAA2CCwANm4JeT2X/8UAKAT+QPrr28PANAJhoQAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbBBYAGwQWABsEFgAbOQ/reFXVwMAdGJFuPvZLwIAGGBICMAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXABoEFwAaBBcAGgQXAxp8BNt4I41Fjr1IAAAAASUVORK5CYII=";

interface SidebarProps {
  view: ViewId;
  onNavigate: (view: ViewId) => void;
  manifest: Manifest | null;
  zones: Zones | null;
}

const NAV_ITEMS: Array<{ id: ViewId; icon: string; label: string; minPass: number }> = [
  { id: "overview", icon: "\u25A3", label: "Overview", minPass: 0 },
  { id: "graph", icon: "\u2B95", label: "Import Graph", minPass: 0 },
  { id: "zones", icon: "\u2B22", label: "Zones", minPass: 0 },
  { id: "files", icon: "\u2630", label: "Files", minPass: 0 },
  { id: "routes", icon: "\u25C7", label: "Routes", minPass: 0 },
  { id: "architecture", icon: "\u25E8", label: "Architecture", minPass: ENRICHMENT_THRESHOLDS.architecture },
  { id: "problems", icon: "\u26A0", label: "Problems", minPass: ENRICHMENT_THRESHOLDS.problems },
  { id: "suggestions", icon: "\u2728", label: "Suggestions", minPass: ENRICHMENT_THRESHOLDS.suggestions },
];

export function Sidebar({ view, onNavigate, manifest, zones }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const gitInfo = manifest
    ? [manifest.gitBranch, manifest.gitSha?.slice(0, 7)].filter(Boolean).join(" @ ")
    : null;

  const enrichmentPass = zones?.enrichmentPass ?? 0;

  const modules = manifest?.modules ?? {};
  const moduleNames = ["inventory", "imports", "zones", "components"];
  const completedCount = moduleNames.filter(
    (m) => modules[m]?.status === "complete"
  ).length;

  const handleNav = (id: ViewId) => {
    onNavigate(id);
    setMobileOpen(false);
  };

  return h("div", {
    class: `sidebar${mobileOpen ? " mobile-open" : ""}`,
    role: "navigation",
    "aria-label": "Main navigation",
  },
    h("div", { class: "sidebar-header" },
      h("div", { class: "flex-row" },
        h("img", { src: LOGO_DARK, class: "sidebar-logo sidebar-logo-dark", alt: "en dash", width: 32, height: 32 }),
        h("img", { src: LOGO_LIGHT, class: "sidebar-logo sidebar-logo-light", alt: "", width: 32, height: 32 }),
        h("h1", null, "SourceVision"),
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
      NAV_ITEMS.map((item) => {
        const locked = item.minPass > 0 && enrichmentPass < item.minPass;
        return h("div", {
          key: item.id,
          class: `nav-item ${view === item.id ? "active" : ""} ${locked ? "locked" : ""}`,
          onClick: locked ? undefined : () => handleNav(item.id),
          role: "button",
          tabIndex: locked ? -1 : 0,
          "aria-current": view === item.id ? "page" : undefined,
          "aria-disabled": locked ? "true" : undefined,
          onKeyDown: (e: KeyboardEvent) => {
            if (!locked && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              handleNav(item.id);
            }
          },
        },
          h("span", { class: "nav-icon", "aria-hidden": "true" }, item.icon),
          item.label,
          locked
            ? h("span", { class: "nav-badge" }, `P${item.minPass}`)
            : null
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
      : null
  );
}
