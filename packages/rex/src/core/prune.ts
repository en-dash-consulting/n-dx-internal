import type { PRDItem } from "../schema/index.js";
import { walkTree } from "./tree.js";

/**
 * Result of a prune operation on the PRD tree.
 *
 * Contains the pruned items (archived subtrees) and the count of
 * items removed. The pruned items preserve their full subtree structure
 * so they can be archived and reviewed later.
 */
export interface PruneResult {
  /** Items removed from the tree (full subtrees, with children intact). */
  pruned: PRDItem[];
  /** Total number of individual items removed (including nested children). */
  prunedCount: number;
}

/**
 * Count the total number of items in a subtree (item + all descendants).
 */
export function countSubtree(item: PRDItem): number {
  let count = 1;
  if (item.children) {
    for (const child of item.children) {
      count += countSubtree(child);
    }
  }
  return count;
}

/**
 * Check whether an item and all its descendants are completed.
 *
 * An item is considered "fully completed" when:
 * - Its own status is "completed"
 * - All children (recursively) are also "completed"
 *
 * Leaf items (no children) only need their own status to be "completed".
 */
export function isFullyCompleted(item: PRDItem): boolean {
  if (item.status !== "completed") return false;
  if (item.children && item.children.length > 0) {
    return item.children.every(isFullyCompleted);
  }
  return true;
}

/**
 * Identify which root-level subtrees (and nested subtrees) are fully
 * completed and eligible for pruning.
 *
 * This is a read-only preview — it does not mutate the tree.
 * Use {@link pruneItems} to actually remove items.
 */
export function findPrunableItems(items: PRDItem[]): PRDItem[] {
  const prunable: PRDItem[] = [];
  for (const { item, parents } of walkTree(items)) {
    // Only prune top-level completed subtrees — skip items whose parent
    // is also fully completed (they'll be pruned as part of the parent).
    if (!isFullyCompleted(item)) continue;
    const parent = parents[parents.length - 1];
    if (parent && isFullyCompleted(parent)) continue;
    prunable.push(item);
  }
  return prunable;
}

/**
 * Remove all fully-completed subtrees from the item tree.
 *
 * Mutates `items` in place — completed subtrees are spliced out
 * and returned in the result so they can be archived.
 *
 * A subtree is pruned when:
 * 1. The item's status is "completed"
 * 2. Every descendant is also "completed"
 *
 * Items that are completed but have non-completed children are NOT pruned
 * (to avoid losing in-progress work).
 */
export function pruneItems(items: PRDItem[]): PruneResult {
  const pruned: PRDItem[] = [];
  let prunedCount = 0;

  // Walk the array in reverse so splicing doesn't shift unvisited indices.
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (isFullyCompleted(item)) {
      // The entire subtree is completed — remove it.
      // Use unshift to maintain original order despite reverse iteration.
      pruned.unshift(item);
      prunedCount += countSubtree(item);
      items.splice(i, 1);
    } else {
      // The item itself isn't fully done, but some children might be.
      if (item.children && item.children.length > 0) {
        const childResult = pruneItems(item.children);
        pruned.push(...childResult.pruned);
        prunedCount += childResult.prunedCount;
      }
    }
  }

  return { pruned, prunedCount };
}
