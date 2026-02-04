/**
 * Automatic parent completion for PRD items.
 *
 * When all children of a parent item are completed (or deferred), the parent
 * can be automatically marked as completed. This walks up the tree from a
 * given item, propagating completion as far as it goes.
 *
 * Rules:
 * - A parent is auto-completable when *every* child is `completed` or `deferred`.
 * - Propagation walks up the ancestor chain: if completing a parent makes its
 *   own parent fully done, that grandparent is completed too.
 * - Only items with `pending` or `in_progress` status are auto-completed
 *   (already-completed, deferred, and blocked parents are left alone).
 * - Returns the list of item IDs that were auto-completed, bottom-up.
 *
 * @module core/parent-completion
 */

import type { PRDItem, ItemStatus } from "../schema/index.js";
import { findItem } from "./tree.js";

export interface AutoCompletionResult {
  /** IDs of items that should be auto-completed, ordered bottom-up (child → ancestor). */
  completedIds: string[];
  /** Human-readable descriptions of what was auto-completed. */
  completedItems: Array<{ id: string; title: string; level: string }>;
}

const AUTO_COMPLETABLE_STATUSES: Set<ItemStatus> = new Set(["pending", "in_progress"]);
const TERMINAL_CHILD_STATUSES: Set<ItemStatus> = new Set(["completed", "deferred"]);

/**
 * Check whether all children of an item are in a terminal state
 * (completed or deferred), treating any IDs in `virtuallyCompleted`
 * as if they were already completed.
 */
function allChildrenTerminal(
  item: PRDItem,
  virtuallyCompleted: Set<string>,
): boolean {
  if (!item.children || item.children.length === 0) return false;
  return item.children.every(
    (c) => TERMINAL_CHILD_STATUSES.has(c.status) || virtuallyCompleted.has(c.id),
  );
}

/**
 * Given a recently-completed item, find all ancestors that should be
 * auto-completed because all their children are now done.
 *
 * Walks up the parent chain, simulating each completion so that
 * grandparents can see their child (which we just decided to complete)
 * as terminal.
 *
 * @param items     - The full PRD item tree.
 * @param itemId    - The ID of the item that just completed.
 * @returns Items to auto-complete, ordered bottom-up. Empty if no propagation needed.
 */
export function findAutoCompletions(
  items: PRDItem[],
  itemId: string,
): AutoCompletionResult {
  const result: AutoCompletionResult = {
    completedIds: [],
    completedItems: [],
  };

  const entry = findItem(items, itemId);
  if (!entry) return result;

  // Track items we've decided to auto-complete so higher ancestors
  // see them as terminal when checking their own children.
  const virtuallyCompleted = new Set<string>([itemId]);

  // Walk up the parent chain from immediate parent to root
  const parents = entry.parents;

  for (let i = parents.length - 1; i >= 0; i--) {
    const parent = parents[i];

    // Only auto-complete parents that are pending or in_progress
    if (!AUTO_COMPLETABLE_STATUSES.has(parent.status)) break;

    // Check if all children are terminal (including virtually completed ones)
    if (!allChildrenTerminal(parent, virtuallyCompleted)) break;

    result.completedIds.push(parent.id);
    result.completedItems.push({
      id: parent.id,
      title: parent.title,
      level: parent.level,
    });

    // This parent is now virtually completed for the next ancestor check
    virtuallyCompleted.add(parent.id);
  }

  return result;
}
