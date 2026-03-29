/**
 * PRD reconciliation — merge worktree task status changes back to main.
 *
 * Reads a worktree's `.rex/prd.json` and applies status changes (completed,
 * failing) to the main PRD via the store API. Operates on task status only —
 * does not merge structural changes (add/remove/reparent).
 *
 * @module parallel/reconcile
 */

import type { PRDDocument, PRDItem, ItemStatus } from "../schema/index.js";
import { walkTree } from "../core/tree.js";
import { validateTransition } from "../core/transitions.js";
import { computeTimestampUpdates } from "../core/timestamps.js";
import type { PRDStore } from "../store/contracts.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Status change detected between worktree and main PRD. */
export interface StatusChange {
  /** Task/item ID. */
  id: string;
  /** Item title (for logging). */
  title: string;
  /** Item level (for logging). */
  level: string;
  /** Status in the main PRD. */
  mainStatus: ItemStatus;
  /** Status in the worktree PRD. */
  worktreeStatus: ItemStatus;
}

/** A single reconciled change that was applied. */
export interface ReconciledChange extends StatusChange {
  /** Whether the change was applied successfully. */
  applied: boolean;
  /** Reason if the change was skipped or failed. */
  reason?: string;
}

/** Summary of reconciliation results. */
export interface ReconcileSummary {
  /** Changes that were applied successfully. */
  reconciled: ReconciledChange[];
  /** Items that had no status change (same in both). */
  skipped: number;
  /** Items that had conflicts (transition not allowed, missing in main, etc.). */
  conflicts: ReconciledChange[];
  /** Total items examined in the worktree PRD. */
  totalExamined: number;
}

// ── Reconcilable statuses ────────────────────────────────────────────────────

/**
 * Statuses that represent meaningful work results in a worktree.
 * Only these status values are propagated back to the main PRD.
 */
const RECONCILABLE_STATUSES: Set<ItemStatus> = new Set([
  "completed",
  "failing",
]);

// ── Core logic ───────────────────────────────────────────────────────────────

/**
 * Build a flat map of item ID → item from a PRD document tree.
 */
function buildItemIndex(items: PRDItem[]): Map<string, PRDItem> {
  const index = new Map<string, PRDItem>();
  for (const { item } of walkTree(items)) {
    index.set(item.id, item);
  }
  return index;
}

/**
 * Detect status changes between a worktree PRD and the main PRD.
 *
 * Only detects changes to {@link RECONCILABLE_STATUSES} — items whose
 * worktree status is not in this set are ignored (they represent
 * intermediate states, not work results).
 */
export function detectChanges(
  mainDoc: PRDDocument,
  worktreeDoc: PRDDocument,
): { changes: StatusChange[]; skipped: number; totalExamined: number } {
  const mainIndex = buildItemIndex(mainDoc.items);
  const changes: StatusChange[] = [];
  let skipped = 0;
  let totalExamined = 0;

  for (const { item: wtItem } of walkTree(worktreeDoc.items)) {
    totalExamined++;

    // Only reconcile items whose worktree status is a work result
    if (!RECONCILABLE_STATUSES.has(wtItem.status)) {
      skipped++;
      continue;
    }

    const mainItem = mainIndex.get(wtItem.id);

    // Item doesn't exist in main — can't reconcile
    if (!mainItem) {
      skipped++;
      continue;
    }

    // Status is the same — nothing to do
    if (mainItem.status === wtItem.status) {
      skipped++;
      continue;
    }

    changes.push({
      id: wtItem.id,
      title: wtItem.title,
      level: wtItem.level,
      mainStatus: mainItem.status,
      worktreeStatus: wtItem.status,
    });
  }

  return { changes, skipped, totalExamined };
}

/**
 * Apply detected status changes to the main PRD store.
 *
 * For each change:
 * 1. Validates the transition is allowed (no --force).
 * 2. Computes timestamp updates (startedAt, completedAt).
 * 3. Applies the update via the store API.
 * 4. Copies resolution metadata (failureReason, resolutionType, resolutionDetail).
 *
 * Changes that fail transition validation are recorded as conflicts.
 */
export async function applyChanges(
  store: PRDStore,
  changes: StatusChange[],
  worktreeDoc: PRDDocument,
): Promise<{ reconciled: ReconciledChange[]; conflicts: ReconciledChange[] }> {
  const wtIndex = buildItemIndex(worktreeDoc.items);
  const reconciled: ReconciledChange[] = [];
  const conflicts: ReconciledChange[] = [];

  for (const change of changes) {
    // Validate transition
    const transition = validateTransition(change.mainStatus, change.worktreeStatus);
    if (!transition.allowed) {
      conflicts.push({
        ...change,
        applied: false,
        reason: transition.message,
      });
      continue;
    }

    // Build the update payload
    const updates: Partial<PRDItem> = {
      status: change.worktreeStatus,
    };

    // Compute timestamps
    const tsUpdates = computeTimestampUpdates(
      change.mainStatus,
      change.worktreeStatus,
      // Use the main item's existing timestamps for correct computation
      await store.getItem(change.id) ?? undefined,
    );
    Object.assign(updates, tsUpdates);

    // Copy resolution metadata from worktree
    const wtItem = wtIndex.get(change.id);
    if (wtItem) {
      if (wtItem.failureReason) updates.failureReason = wtItem.failureReason;
      if (wtItem.resolutionType) updates.resolutionType = wtItem.resolutionType;
      if (wtItem.resolutionDetail) updates.resolutionDetail = wtItem.resolutionDetail;
    }

    try {
      await store.updateItem(change.id, updates);
      reconciled.push({ ...change, applied: true });
    } catch (err) {
      conflicts.push({
        ...change,
        applied: false,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { reconciled, conflicts };
}

/**
 * Reconcile worktree task completions back to the main PRD.
 *
 * This is the main entry point. It:
 * 1. Detects status changes between worktree and main PRD documents.
 * 2. Applies valid changes to the main PRD store.
 * 3. Logs each reconciled change.
 * 4. Returns a summary of what was done.
 *
 * @param store        - The main PRD store (will be mutated).
 * @param worktreeDoc  - The worktree's PRD document (read-only).
 * @returns Summary of reconciliation results.
 */
export async function reconcile(
  store: PRDStore,
  worktreeDoc: PRDDocument,
): Promise<ReconcileSummary> {
  const mainDoc = await store.loadDocument();

  // Step 1: detect changes
  const { changes, skipped, totalExamined } = detectChanges(mainDoc, worktreeDoc);

  // Step 2: apply changes
  const { reconciled, conflicts } = await applyChanges(store, changes, worktreeDoc);

  // Step 3: log each reconciled change
  for (const change of reconciled) {
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "parallel_reconciled",
      itemId: change.id,
      detail: `Reconciled ${change.level} "${change.title}": ${change.mainStatus} → ${change.worktreeStatus}`,
    });
  }

  // Log conflicts too
  for (const conflict of conflicts) {
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "parallel_reconcile_conflict",
      itemId: conflict.id,
      detail: `Conflict: ${conflict.level} "${conflict.title}": ${conflict.mainStatus} → ${conflict.worktreeStatus} — ${conflict.reason}`,
    });
  }

  return {
    reconciled,
    skipped,
    conflicts,
    totalExamined,
  };
}
