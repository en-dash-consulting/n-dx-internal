/**
 * Public facade for the task-usage-tracking zone.
 *
 * Re-exports the two services (incremental aggregation and cleanup scheduling)
 * through a single module so consumers don't couple to internal file paths.
 *
 * Consumers should import from this facade rather than directly from
 * `incremental-task-usage.js` or `usage-cleanup-scheduler.js`.
 *
 * @module web/server/task-usage
 */

// ── Incremental task usage aggregation ───────────────────────────────

export {
  IncrementalTaskUsageAggregator,
  type TaskUsageAccumulator,
} from "./incremental-task-usage.js";

// ── Cleanup scheduling ───────────────────────────────────────────────

export {
  startUsageCleanupScheduler,
  runCleanupCycle,
  identifyOrphanedEntries,
  loadCleanupConfig,
  writeCleanupLog,
  DEFAULT_CLEANUP_INTERVAL_MS,
  type CollectAllIdsFn,
  type CleanupResult,
  type CleanupConfig,
  type CleanupLogEntry,
  type OrphanedEntry,
} from "./usage-cleanup-scheduler.js";
