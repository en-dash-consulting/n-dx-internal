import type { PRDItem } from "../schema/index.js";
import { findItem, removeFromTree, walkTree } from "./tree.js";

/**
 * Delete an item and all its descendants from the tree.
 * Returns the list of all deleted item IDs.
 */
export function deleteItem(items: PRDItem[], id: string): string[] {
  const entry = findItem(items, id);
  if (!entry) return [];

  // Collect all IDs that will be deleted (the item + all descendants)
  const deletedIds: string[] = [];
  function collectIds(item: PRDItem): void {
    deletedIds.push(item.id);
    if (item.children) {
      for (const child of item.children) {
        collectIds(child);
      }
    }
  }
  collectIds(entry.item);

  // Remove from tree
  removeFromTree(items, id);

  return deletedIds;
}

/**
 * Remove deleted IDs from all items' `blockedBy` arrays.
 */
export function cleanBlockedByRefs(items: PRDItem[], deletedIds: Set<string>): void {
  for (const { item } of walkTree(items)) {
    if (item.blockedBy && item.blockedBy.length > 0) {
      item.blockedBy = item.blockedBy.filter((ref) => !deletedIds.has(ref));
      if (item.blockedBy.length === 0) {
        delete item.blockedBy;
      }
    }
  }
}
