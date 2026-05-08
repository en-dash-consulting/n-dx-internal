/**
 * Utilities for computing folder-tree paths for PRD items.
 */

import type { PRDItem } from "../schema/index.js";
import { findItem } from "../core/tree.js";
import { slugify, PRD_TREE_DIRNAME } from "../store/index.js";

/**
 * Compute the folder-tree path for a given item, mirroring the on-disk
 * layout the serializer produces.
 *
 * Every PRD item — epic, feature, task, or branch subtask — gets its own
 * folder named with its slug containing `index.md`. Leaf subtasks (Rule 1b)
 * are written as a bare `<slug>.md` file inside the parent task's folder
 * with no intermediate directory; for those we return the path to the `.md`
 * file rather than to a non-existent folder.
 */
export function getFolderTreePath(items: PRDItem[], itemId: string): string | undefined {
  const entry = findItem(items, itemId);
  if (!entry) return undefined;

  const { item, parents } = entry;

  const pathSegments = [".rex", PRD_TREE_DIRNAME];
  for (const ancestor of parents) {
    pathSegments.push(slugify(ancestor.title, ancestor.id));
  }

  const isLeafSubtask = item.level === "subtask" && (item.children?.length ?? 0) === 0;
  const itemSlug = slugify(item.title, item.id);
  pathSegments.push(isLeafSubtask ? `${itemSlug}.md` : itemSlug);

  return pathSegments.join("/");
}
