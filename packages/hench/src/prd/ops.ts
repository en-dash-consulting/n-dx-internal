/**
 * Centralized gateway for rex runtime imports.
 *
 * Hench needs several rex functions at runtime (tree traversal, task
 * selection, timestamp computation, auto-completion).  Rather than
 * scattering `import … from "rex"` across 9+ files, every runtime
 * import is funnelled through this single module.  This makes the
 * cross-package dependency surface explicit and easy to audit.
 *
 * **Type-only** imports (`import type { PRDStore, … } from "rex"`)
 * are deliberately excluded — they are erased at compile time and
 * create zero runtime coupling.  Those stay at the call-site where
 * they provide local type-safety.
 *
 * @module hench/prd/ops
 */

// ---- Store factory ----------------------------------------------------------
export { resolveStore } from "rex";

// ---- Tree utilities ---------------------------------------------------------
export { findItem, walkTree } from "rex";

// ---- Task selection ---------------------------------------------------------
export { findNextTask, findActionableTasks, collectCompletedIds } from "rex";

// ---- Timestamps -------------------------------------------------------------
export { computeTimestampUpdates } from "rex";

// ---- Parent auto-completion -------------------------------------------------
export { findAutoCompletions } from "rex";
