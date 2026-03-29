/**
 * View registry — maps ViewId to render functions.
 *
 * Centralizes all view component imports and the view-to-component
 * dispatch logic. main.ts imports only `renderActiveView` and
 * `buildValidViews` from here instead of 22 individual view modules.
 */

import { h } from "preact";
import type { ComponentChild, VNode } from "preact";
import type { ViewId, NavigateTo, DetailItem, LoadedData } from "../types.js";
import type { DegradableFeature } from "../performance/index.js";
import { SOURCEVISION_TAB_IDS } from "./sourcevision-tabs.js";

// ── View component imports (via domain barrels) ────────────────
//
// Each domain barrel groups related view components behind a single
// import boundary. This creates natural decomposition points that:
//   - Make the import surface explicit and auditable
//   - Enable future lazy-loading per domain
//   - Reduce the blast radius of view-level changes

import {
  Overview,
  Graph,
  ZonesView,
  FilesView,
  ExplorerView,
  SvAnalysisView,
  ArchitectureView,
  ProblemsView,
  SuggestionsView,
  RoutesView,
  EndpointsView,
  ConfigSurfaceView,
} from "./domain-sourcevision.js";

import {
  PRDView,
  RexDashboard,
  TokenUsageView,
  ValidationView,
  TaskAuditView,
  WorkflowOptimizationView,
} from "./domain-rex.js";

import {
  HenchRunsView,
  HenchConfigView,
  HenchTemplatesView,
} from "./domain-hench.js";

import {
  NotionConfigView,
  IntegrationConfigView,
  FeatureTogglesView,
} from "./domain-settings.js";

// ── View render context ────────────────────────────────────────

/** Props available to any view render function. */
export interface ViewRenderContext {
  data: LoadedData;
  setDetail: (item: DetailItem | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setPrdDetailContent: (content: VNode<any> | null) => void;
  selectedFile: string | null;
  setSelectedFile: (f: string | null) => void;
  selectedZone: string | null;
  selectedRunId: string | null;
  selectedTaskId: string | null;
  /** Explorer sub-tab (files, functions, properties). */
  explorerTab: string | null;
  /** Circular dependency cycle to focus in the graph. */
  focusCycle: string[] | null;
  navigateTo: NavigateTo;
  isFeatureDisabled: (feature: DegradableFeature) => boolean;
}

// ── Registry ───────────────────────────────────────────────────

type ViewRenderer = (ctx: ViewRenderContext) => ComponentChild;

const REGISTRY: Record<string, ViewRenderer> = {
  "overview": ({ data, navigateTo }) =>
    h(Overview, { data, navigateTo }),

  "explorer": ({ data, setDetail, selectedFile, setSelectedFile, selectedZone, focusCycle, navigateTo, isFeatureDisabled, explorerTab }) =>
    h(ExplorerView, { data, onSelect: setDetail, selectedFile, setSelectedFile, selectedZone, focusCycle, navigateTo, isGraphDisabled: isFeatureDisabled("graphRendering"), initialTab: explorerTab }),

  // Legacy routes — redirect to Explorer view
  "graph": ({ data, setDetail, selectedFile, setSelectedFile, selectedZone, focusCycle, navigateTo, isFeatureDisabled }) =>
    h(ExplorerView, { data, onSelect: setDetail, selectedFile, setSelectedFile, selectedZone, focusCycle, navigateTo, isGraphDisabled: isFeatureDisabled("graphRendering") }),

  "files": ({ data, setDetail, selectedFile, setSelectedFile, selectedZone, focusCycle, navigateTo, isFeatureDisabled }) =>
    h(ExplorerView, { data, onSelect: setDetail, selectedFile, setSelectedFile, selectedZone, focusCycle, navigateTo, isGraphDisabled: isFeatureDisabled("graphRendering") }),

  "zones": ({ data, setDetail, navigateTo }) =>
    h(ZonesView, { data, onSelect: setDetail, navigateTo }),

  "endpoints": ({ data, navigateTo }) =>
    h(EndpointsView, { data, navigateTo }),

  // Legacy route — redirect to Endpoints view
  "routes": ({ data, navigateTo }) =>
    h(EndpointsView, { data, navigateTo }),

  "config-surface": ({ data, setDetail, navigateTo }) =>
    h(ConfigSurfaceView, { data, onSelect: setDetail, navigateTo }),

  "analysis": ({ data, setDetail, navigateTo }) =>
    h(SvAnalysisView, { data, onSelect: setDetail, navigateTo }),

  // Legacy routes — redirect to unified Analysis view
  "architecture": ({ data, setDetail, navigateTo }) =>
    h(SvAnalysisView, { data, onSelect: setDetail, navigateTo }),

  "problems": ({ data, setDetail, navigateTo }) =>
    h(SvAnalysisView, { data, onSelect: setDetail, navigateTo }),

  "suggestions": ({ data, setDetail, navigateTo }) =>
    h(SvAnalysisView, { data, onSelect: setDetail, navigateTo }),

  // Legacy route — PR Markdown has been migrated to the /pr-description Claude Code skill
  "pr-markdown": () =>
    h("div", { class: "card", style: "margin-top: 16px" },
      h("h3", { class: "section-header-sm" }, "PR Markdown has moved"),
      h("p", null,
        "PR description generation is now available as the ",
        h("code", null, "/pr-description"),
        " Claude Code skill.",
      ),
      h("p", null,
        "Run ",
        h("code", null, "/pr-description"),
        " in Claude Code to generate a PR description enriched with architectural context.",
      ),
    ),

  "rex-dashboard": ({ navigateTo }) =>
    h(RexDashboard, { navigateTo }),

  "prd": ({ setDetail, setPrdDetailContent, selectedTaskId, navigateTo }) =>
    h(PRDView, { onSelectItem: setDetail, onDetailContent: setPrdDetailContent, initialTaskId: selectedTaskId, navigateTo }),

  "token-usage": () =>
    h(TokenUsageView, null),

  "validation": ({ navigateTo }) =>
    h(ValidationView, { navigateTo }),

  "notion-config": () =>
    h(NotionConfigView, null),

  "integrations": () =>
    h(IntegrationConfigView, null),

  "hench-runs": ({ navigateTo, selectedRunId }) =>
    h(HenchRunsView, { navigateTo, initialRunId: selectedRunId }),

  "hench-audit": ({ navigateTo }) =>
    h(TaskAuditView, { navigateTo }),

  "hench-config": () =>
    h(HenchConfigView, null),

  "hench-templates": () =>
    h(HenchTemplatesView, null),

  "hench-optimization": () =>
    h(WorkflowOptimizationView, null),

  "feature-toggles": () =>
    h(FeatureTogglesView, null),
};

/** Render the view identified by `view` using props from `ctx`. */
export function renderActiveView(view: ViewId, ctx: ViewRenderContext): ComponentChild {
  const renderer = REGISTRY[view];
  return renderer ? renderer(ctx) : null;
}

// ── Scope & valid-view helpers ─────────────────────────────────

/** All known views grouped by product scope. */
const VIEWS_BY_SCOPE: Record<string, ViewId[]> = {
  sourcevision: SOURCEVISION_TAB_IDS,
  rex: ["rex-dashboard", "prd", "validation", "notion-config", "integrations"],
  hench: ["hench-runs", "hench-audit", "hench-config", "hench-templates", "hench-optimization"],
};

/** Cross-cutting views available in all scopes. */
const CROSS_CUTTING_VIEWS: ViewId[] = ["token-usage", "feature-toggles"];

/**
 * Legacy views that still resolve (to show migration messages) but are not
 * in any scope's tab list. Includes views migrated to Claude Code skills
 * and consolidated views that redirect to replacements.
 */
const LEGACY_VIEWS: ViewId[] = [
  "pr-markdown",   // Migrated to /pr-description skill
  "graph",         // Consolidated into explorer
  "files",         // Consolidated into explorer
  "routes",        // Consolidated into endpoints
  "architecture",  // Consolidated into analysis
  "problems",      // Consolidated into analysis
  "suggestions",   // Consolidated into analysis
];

const ALL_VIEWS = new Set<ViewId>([
  ...Object.values(VIEWS_BY_SCOPE).flat(),
  ...CROSS_CUTTING_VIEWS,
  ...LEGACY_VIEWS,
] as ViewId[]);

/** Build the valid view set based on an optional scope. */
export function buildValidViews(scope: string | null): Set<ViewId> {
  if (!scope || scope === "all") return ALL_VIEWS;
  return new Set<ViewId>([...(VIEWS_BY_SCOPE[scope] ?? []), ...CROSS_CUTTING_VIEWS, ...LEGACY_VIEWS] as ViewId[]);
}
