/**
 * Single-child compaction: deprecated, retained as a no-op.
 *
 * The previous schema used `__parent*` shims to elide parent folders when an
 * item had exactly one child. The current schema (see
 * `docs/architecture/prd-folder-tree-schema.md`) stores every PRD item in
 * its own folder containing `index.md`. There is no longer any disk-side
 * "compaction" step.
 *
 * Existing trees that still contain `__parent*` shims are normalized
 * implicitly by the parser+serializer round-trip: the parser reconstructs
 * the missing parent in memory, and the next save writes every item back
 * to its own folder while the serializer's `removeStaleEntries` sweeps up
 * the elided child file. Callers should drive that round-trip via
 * `store.saveDocument(await store.loadDocument())` rather than calling this
 * function.
 *
 * The function below is kept (returning a zero-change result) so that
 * older callers and tests that import the symbol do not break during the
 * transition. New callers must not depend on it.
 *
 * @deprecated Use `store.saveDocument(await store.loadDocument())` to
 * canonicalize the on-disk tree.
 *
 * @module core/compact-single-children
 */

/**
 * Result of running the single-child compaction migration.
 */
export interface CompactionResult {
  /** Number of directories that were compacted. */
  compactedCount: number;
  /** Errors encountered during compaction. */
  errors: Array<{ path: string; error: string }>;
}

/**
 * @deprecated No-op. See module documentation for the replacement workflow.
 */
export async function compactSingleChildren(_treeRoot: string): Promise<CompactionResult> {
  return { compactedCount: 0, errors: [] };
}
