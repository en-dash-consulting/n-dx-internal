import type { PRDItem } from "../schema/index.js";
import { walkTree, collectAllIds } from "./tree.js";

export interface DAGResult {
  valid: boolean;
  errors: string[];
}

export function validateDAG(items: PRDItem[]): DAGResult {
  const errors: string[] = [];

  // Collect all IDs, detect duplicates
  const seenIds = new Map<string, number>();
  for (const { item } of walkTree(items)) {
    const count = seenIds.get(item.id) ?? 0;
    seenIds.set(item.id, count + 1);
  }

  for (const [id, count] of seenIds) {
    if (count > 1) {
      errors.push(`Duplicate ID: "${id}" appears ${count} times`);
    }
  }

  const allIds = collectAllIds(items);

  // Check blockedBy references and self-references
  for (const { item } of walkTree(items)) {
    if (item.blockedBy) {
      for (const dep of item.blockedBy) {
        if (dep === item.id) {
          errors.push(`Self-reference: "${item.id}" blocks itself`);
        } else if (!allIds.has(dep)) {
          errors.push(
            `Orphan reference: "${item.id}" blocked by unknown "${dep}"`,
          );
        }
      }
    }
  }

  // DFS cycle detection on the blockedBy graph
  const adjacency = new Map<string, string[]>();
  for (const { item } of walkTree(items)) {
    if (item.blockedBy && item.blockedBy.length > 0) {
      adjacency.set(item.id, item.blockedBy.filter((d) => allIds.has(d)));
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): boolean {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node);
      errors.push(`Cycle detected: ${cycle.join(" → ")}`);
      return true;
    }
    if (visited.has(node)) return false;

    visited.add(node);
    inStack.add(node);

    const deps = adjacency.get(node) ?? [];
    for (const dep of deps) {
      if (dfs(dep, [...path, node])) return true;
    }

    inStack.delete(node);
    return false;
  }

  for (const id of allIds) {
    if (!visited.has(id)) {
      dfs(id, []);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
