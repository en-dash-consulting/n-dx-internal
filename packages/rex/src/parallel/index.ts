/**
 * Parallel worktree execution module — barrel export.
 *
 * Provides blast radius computation, conflict analysis, and execution
 * plan formatting for parallel task execution across worktrees.
 *
 * @module rex/parallel
 */

// ── Blast radius ─────────────────────────────────────────────────────────────

export type { ZoneIndex, ImportGraph } from "./blast-radius.js";
export {
  blastRadius,
  extractPathsFromCriteria,
  resolveModuleNames,
  expandImportNeighbors,
  expandZoneTags,
} from "./blast-radius.js";

// ── Conflict analysis ────────────────────────────────────────────────────────

export type {
  ConflictConfidence,
  ConflictEdge,
  ConflictGraph,
  Conflict,
  TaskGroup,
  ExecutionPlan,
} from "./conflict-analysis.js";
export {
  buildConflictGraph,
  findIndependentSets,
} from "./conflict-analysis.js";

// ── Execution plan ───────────────────────────────────────────────────────────

export type { FormattedExecutionPlan } from "./execution-plan.js";
export {
  computeExecutionPlan,
  formatExecutionPlan,
} from "./execution-plan.js";

// ── Reconciliation ──────────────────────────────────────────────────────

export type {
  StatusChange,
  ReconciledChange,
  ReconcileSummary,
} from "./reconcile.js";
export {
  detectChanges,
  applyChanges,
  reconcile,
} from "./reconcile.js";
