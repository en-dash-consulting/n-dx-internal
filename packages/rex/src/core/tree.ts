import type { PRDItem, ItemLevel } from "../schema/index.js";
import { LEVEL_HIERARCHY } from "../schema/index.js";

// ---- Traversal primitives ---------------------------------------------------

export interface TreeEntry {
  item: PRDItem;
  parents: PRDItem[];
}

export function* walkTree(
  items: PRDItem[],
  parentChain: PRDItem[] = [],
): Generator<TreeEntry> {
  for (const item of items) {
    yield { item, parents: parentChain };
    if (item.children && item.children.length > 0) {
      yield* walkTree(item.children, [...parentChain, item]);
    }
  }
}

export function findItem(
  items: PRDItem[],
  id: string,
): TreeEntry | null {
  for (const entry of walkTree(items)) {
    if (entry.item.id === id) {
      return entry;
    }
  }
  return null;
}

export function getParentChain(items: PRDItem[], id: string): PRDItem[] {
  const entry = findItem(items, id);
  return entry ? entry.parents : [];
}

export function collectAllIds(items: PRDItem[]): Set<string> {
  const ids = new Set<string>();
  for (const { item } of walkTree(items)) {
    ids.add(item.id);
  }
  return ids;
}

// ---- Tree mutations ---------------------------------------------------------

export function insertChild(
  items: PRDItem[],
  parentId: string,
  child: PRDItem,
): boolean {
  for (const entry of walkTree(items)) {
    if (entry.item.id === parentId) {
      // Validate hierarchy: child's allowed parents must include this parent's level
      const allowedParents = LEVEL_HIERARCHY[child.level];
      if (allowedParents) {
        const allowedParentLevels = allowedParents.filter((p): p is ItemLevel => p !== null);
        // If only null is allowed, this item can only be root (no parent)
        if (allowedParentLevels.length === 0) {
          return false;
        }
        if (!allowedParentLevels.includes(entry.item.level)) {
          return false;
        }
      }

      if (!entry.item.children) {
        entry.item.children = [];
      }
      entry.item.children.push(child);
      return true;
    }
  }
  return false;
}

export function updateInTree(
  items: PRDItem[],
  id: string,
  updates: Partial<PRDItem>,
): boolean {
  for (const entry of walkTree(items)) {
    if (entry.item.id === id) {
      Object.assign(entry.item, updates);
      return true;
    }
  }
  return false;
}

export function removeFromTree(items: PRDItem[], id: string): PRDItem | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) {
      return items.splice(i, 1)[0];
    }
    if (items[i].children) {
      const removed = removeFromTree(items[i].children!, id);
      if (removed) return removed;
    }
  }
  return null;
}
