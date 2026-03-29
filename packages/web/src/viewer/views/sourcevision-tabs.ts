/**
 * SourceVision tab configuration — domain-specific view tab definitions.
 *
 * Defines the tab IDs, labels, icons, and minimum enrichment pass required
 * for each SourceVision view. Tabs can optionally require a detected
 * framework or framework category to be visible — tabs without a
 * requirement always show.
 *
 * This is sourcevision domain config, not a generic infrastructure primitive.
 */
import type { ViewId } from "../types.js";
import type { DetectedFrameworks, FrameworkCategory } from "../external.js";
import { ENRICHMENT_THRESHOLDS } from "./enrichment-thresholds.js";

export type SourceVisionTabId = Extract<
  ViewId,
  | "overview" | "explorer" | "graph" | "zones" | "files" | "routes" | "endpoints"
  | "config-surface" | "analysis" | "architecture" | "problems" | "suggestions"
>;

export interface SourceVisionTab {
  id: SourceVisionTabId;
  icon: string;
  label: string;
  minPass: number;
  featureGate?: string;
  /**
   * When set, this tab is only visible if a framework matching this ID is
   * detected with sufficient confidence. Example: "react-router-v7".
   */
  requiredFramework?: string;
  /**
   * When set, this tab is only visible if at least one framework in the
   * given category is detected with sufficient confidence.
   * Example: "backend" for the Endpoints tab.
   */
  requiredCategory?: FrameworkCategory;
}

/** Default minimum confidence for a detected framework to satisfy a tab requirement. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

/**
 * All sourcevision tab definitions. Tabs with `requiredFramework` or
 * `requiredCategory` are conditionally visible based on detected frameworks.
 * Tabs with neither requirement always show.
 */
export const SOURCEVISION_TABS: readonly SourceVisionTab[] = [
  { id: "overview", icon: "\u25A3", label: "Overview", minPass: 0 },
  { id: "explorer", icon: "\u2630", label: "Explorer", minPass: 0 },
  { id: "zones", icon: "\u2B22", label: "Zones", minPass: 0 },
  { id: "endpoints", icon: "\u25C7", label: "Endpoints", minPass: 0, requiredCategory: "backend" },
  { id: "config-surface", icon: "\u2699", label: "Configuration", minPass: 0 },
  { id: "analysis", icon: "\u25E8", label: "Analysis", minPass: ENRICHMENT_THRESHOLDS.analysis },
];

/**
 * Returns the subset of SOURCEVISION_TABS visible given the detected frameworks.
 *
 * - Tabs with no `requiredFramework`/`requiredCategory` always pass.
 * - When `frameworks` is null (not yet loaded), all tabs pass — this avoids
 *   hiding tabs that would be shown once frameworks.json loads.
 * - The confidence threshold is configurable (default 0.5).
 */
export function getVisibleTabs(
  frameworks: DetectedFrameworks | null,
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): readonly SourceVisionTab[] {
  // When frameworks data is not yet available, show all tabs (graceful fallback).
  if (!frameworks) return SOURCEVISION_TABS;

  return SOURCEVISION_TABS.filter((tab) => {
    // Tabs with no framework requirement always show.
    if (!tab.requiredFramework && !tab.requiredCategory) return true;

    const detected = frameworks.frameworks;

    // Check specific framework ID requirement.
    if (tab.requiredFramework) {
      return detected.some(
        (fw) => fw.id === tab.requiredFramework && fw.confidence >= confidenceThreshold,
      );
    }

    // Check category requirement.
    if (tab.requiredCategory) {
      return detected.some(
        (fw) => fw.category === tab.requiredCategory && fw.confidence >= confidenceThreshold,
      );
    }

    return true;
  });
}

/**
 * Static list of all tab IDs (used by view-registry for scope validation).
 * This remains the full list — view-registry needs all possible IDs to
 * recognize deep links, even if the tab isn't currently visible in the sidebar.
 */
export const SOURCEVISION_TAB_IDS: SourceVisionTabId[] = SOURCEVISION_TABS.map((tab) => tab.id);
