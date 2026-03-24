/**
 * Proactive PRD structure health checks.
 *
 * Evaluates the PRD tree against configurable thresholds and returns
 * warnings when the structure degrades. Used by CLI write commands
 * (add, analyze, plan) and the CI gate.
 *
 * @module core/structure-health
 */

import type { PRDItem, StructureHealthThresholds } from "../schema/index.js";

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULTS: Required<StructureHealthThresholds> = {
  maxTopLevelEpics: 15,
  maxTreeDepth: 5,
  maxChildrenPerContainer: 20,
  minChildrenPerContainer: 2,
};

// ── Types ────────────────────────────────────────────────────────────

export interface StructureWarning {
  /** Which threshold was crossed. */
  type: "too-many-epics" | "too-deep" | "oversized-container" | "undersized-container";
  /** Human-readable warning message. */
  message: string;
  /** The actual value that crossed the threshold. */
  actual: number;
  /** The configured threshold. */
  threshold: number;
  /** Item ID for container-specific warnings. */
  itemId?: string;
  /** Item title for container-specific warnings. */
  itemTitle?: string;
}

export interface StructureHealthResult {
  /** True when no thresholds are crossed. */
  healthy: boolean;
  /** Warnings for each crossed threshold. */
  warnings: StructureWarning[];
}

// ── Implementation ───────────────────────────────────────────────────

function resolveThresholds(overrides?: StructureHealthThresholds): Required<StructureHealthThresholds> {
  return { ...DEFAULTS, ...overrides };
}

function computeMaxDepth(items: PRDItem[], depth: number = 1): number {
  let max = depth;
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      const childDepth = computeMaxDepth(item.children, depth + 1);
      if (childDepth > max) max = childDepth;
    }
  }
  return max;
}

/**
 * Check the PRD tree against structure health thresholds.
 *
 * @param items - Top-level PRD items
 * @param overrides - Optional threshold overrides from config
 * @returns Health result with warnings for each crossed threshold
 */
export function checkStructureHealth(
  items: PRDItem[],
  overrides?: StructureHealthThresholds,
): StructureHealthResult {
  const thresholds = resolveThresholds(overrides);
  const warnings: StructureWarning[] = [];

  // 1. Top-level epic count
  const epicCount = items.filter((i) => i.status !== "deleted").length;
  if (epicCount > thresholds.maxTopLevelEpics) {
    warnings.push({
      type: "too-many-epics",
      message: `PRD has ${epicCount} top-level epics (threshold: ${thresholds.maxTopLevelEpics}). Consider grouping related epics with /ndx-reshape.`,
      actual: epicCount,
      threshold: thresholds.maxTopLevelEpics,
    });
  }

  // 2. Max tree depth
  const maxDepth = computeMaxDepth(items);
  if (maxDepth > thresholds.maxTreeDepth) {
    warnings.push({
      type: "too-deep",
      message: `PRD tree is ${maxDepth} levels deep (threshold: ${thresholds.maxTreeDepth}). Consider flattening with rex reorganize.`,
      actual: maxDepth,
      threshold: thresholds.maxTreeDepth,
    });
  }

  // 3. Oversized and undersized containers
  function walkContainers(containerItems: PRDItem[]): void {
    for (const item of containerItems) {
      if (item.status === "deleted") continue;
      if (!item.children || item.children.length === 0) continue;

      const activeChildren = item.children.filter((c) => c.status !== "deleted");
      const count = activeChildren.length;

      if (count > thresholds.maxChildrenPerContainer) {
        warnings.push({
          type: "oversized-container",
          message: `"${item.title}" has ${count} children (threshold: ${thresholds.maxChildrenPerContainer}). Consider splitting.`,
          actual: count,
          threshold: thresholds.maxChildrenPerContainer,
          itemId: item.id,
          itemTitle: item.title,
        });
      }

      if (count < thresholds.minChildrenPerContainer) {
        warnings.push({
          type: "undersized-container",
          message: `"${item.title}" has only ${count} child (threshold: ${thresholds.minChildrenPerContainer}). Consider merging with a sibling.`,
          actual: count,
          threshold: thresholds.minChildrenPerContainer,
          itemId: item.id,
          itemTitle: item.title,
        });
      }

      walkContainers(activeChildren);
    }
  }

  walkContainers(items);

  return { healthy: warnings.length === 0, warnings };
}
