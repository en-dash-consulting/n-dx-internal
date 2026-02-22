/**
 * Centralized gateway for Rex runtime imports.
 *
 * Web routes consume Rex through this boundary rather than importing directly
 * from "rex". This keeps Rex coupling auditable and localized.
 */

// ---- Rex MCP server factory -------------------------------------------------
export { createRexMcpServer } from "rex";

// ---- Rex domain types & constants -------------------------------------------
export type { Priority, ItemLevel, ItemStatus } from "rex";
export type { RequirementCategory, RequirementValidationType } from "rex";
export type { PRDItem, PRDDocument, Requirement } from "rex";
export {
  PRIORITY_ORDER,
  LEVEL_HIERARCHY,
  VALID_LEVELS,
  VALID_STATUSES,
  VALID_PRIORITIES,
  VALID_REQUIREMENT_CATEGORIES,
  VALID_VALIDATION_TYPES,
  CHILD_LEVEL,
  isPriority,
  isItemLevel,
  isRequirementCategory,
  isValidationType,
} from "rex";

// ---- Rex tree utilities -----------------------------------------------------
export {
  findItem,
  walkTree,
  insertChild,
  updateInTree,
  removeFromTree,
  computeStats,
  collectAllIds,
} from "rex";
export type { TreeEntry, TreeStats } from "rex";

// ---- Rex task selection -----------------------------------------------------
export { findNextTask, collectCompletedIds } from "rex";

// ---- Rex timestamps ---------------------------------------------------------
export { computeTimestampUpdates } from "rex";

// ---- Rex merge/consolidation ------------------------------------------------
export { validateMerge, previewMerge, mergeItems } from "rex";
export type { MergeValidation, MergePreview, MergeResult } from "rex";

// ---- Rex prune --------------------------------------------------------------
export { countSubtree, isFullyCompleted, findPrunableItems, pruneItems } from "rex";

// ---- Rex analytics ----------------------------------------------------------
export {
  computeEpicStats,
  computePriorityDistribution,
  computeRequirementsSummary,
} from "rex";
export type { EpicStats, PriorityDistribution, RequirementsSummary } from "rex";
