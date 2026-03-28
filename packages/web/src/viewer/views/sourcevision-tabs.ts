/**
 * SourceVision tab configuration — domain-specific view tab definitions.
 *
 * Defines the tab IDs, labels, icons, and minimum enrichment pass required
 * for each SourceVision view. This is sourcevision domain config, not a
 * generic infrastructure primitive.
 */
import type { ViewId } from "../types.js";
import { ENRICHMENT_THRESHOLDS } from "./enrichment-thresholds.js";

export type SourceVisionTabId = Extract<
  ViewId,
  | "overview" | "explorer" | "graph" | "zones" | "files" | "routes" | "endpoints"
  | "config-surface" | "analysis" | "architecture" | "problems" | "suggestions" | "pr-markdown"
>;

export interface SourceVisionTab {
  id: SourceVisionTabId;
  icon: string;
  label: string;
  minPass: number;
  featureGate?: string;
}

export const SOURCEVISION_TABS: readonly SourceVisionTab[] = [
  { id: "overview", icon: "\u25A3", label: "Overview", minPass: 0 },
  { id: "explorer", icon: "\u2630", label: "Explorer", minPass: 0 },
  { id: "zones", icon: "\u2B22", label: "Zones", minPass: 0 },
  { id: "endpoints", icon: "\u25C7", label: "Endpoints", minPass: 0 },
  { id: "config-surface", icon: "\u2699", label: "Configuration", minPass: 0 },
  { id: "analysis", icon: "\u25E8", label: "Analysis", minPass: ENRICHMENT_THRESHOLDS.analysis },
  { id: "pr-markdown", icon: "\u270D", label: "PR Markdown", minPass: 0 },
];

export const SOURCEVISION_TAB_IDS: SourceVisionTabId[] = SOURCEVISION_TABS.map((tab) => tab.id);
