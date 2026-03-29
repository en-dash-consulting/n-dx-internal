/**
 * Conflict graph construction and independent set detection for parallel execution.
 *
 * Builds a conflict graph where nodes are actionable tasks and edges connect
 * tasks whose blast radii overlap. Uses greedy graph coloring to find
 * independent sets — groups of tasks that can safely run in parallel worktrees.
 *
 * Edge classification:
 * - high:   direct file overlap (both tasks touch the same file)
 * - medium: shared import neighborhood (files are 1-hop neighbors in the import graph)
 * - low:    same zone but different files (structural proximity, no file overlap)
 *
 * @module rex/parallel/conflict-analysis
 */

import type { PRDItem } from "../schema/v1.js";
import type { ZoneIndex, ImportGraph } from "./blast-radius.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Confidence level of a conflict edge. */
export type ConflictConfidence = "high" | "medium" | "low";

/** A directed or undirected edge in the conflict graph. */
export interface ConflictEdge {
  /** The other task ID this edge connects to. */
  targetId: string;
  /** Number of overlapping files (weight). */
  weight: number;
  /** Confidence classification for this overlap. */
  confidence: ConflictConfidence;
  /** Sample of overlapping files (up to 5 for diagnostics). */
  overlappingFiles: string[];
}

/** Adjacency list representation of the conflict graph. */
export type ConflictGraph = Map<string, ConflictEdge[]>;

/** A detected conflict between two tasks. */
export interface Conflict {
  taskA: string;
  taskB: string;
  weight: number;
  confidence: ConflictConfidence;
  overlappingFiles: string[];
}

/** A group of tasks that can run in parallel (independent set). */
export interface TaskGroup {
  /** Unique group index (0-based). */
  index: number;
  /** Task IDs in this group. */
  taskIds: string[];
  /** Estimated total file count across all tasks in the group. */
  estimatedSize: number;
}

/** The full execution plan for parallel worktree execution. */
export interface ExecutionPlan {
  /** Groups of independent tasks that can run in parallel. */
  groups: TaskGroup[];
  /** Tasks that must run sequentially (have blockedBy dependencies within actionable set). */
  serialTasks: string[];
  /** All detected conflicts between tasks. */
  conflicts: Conflict[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Compute the intersection of two sets. */
function setIntersection<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set<T>();
  // Iterate over the smaller set for efficiency
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of smaller) {
    if (larger.has(item)) {
      result.add(item);
    }
  }
  return result;
}

/** Sample up to N items from a set. */
function sampleSet(set: Set<string>, n: number): string[] {
  const result: string[] = [];
  for (const item of set) {
    result.push(item);
    if (result.length >= n) break;
  }
  return result;
}

/**
 * Build a parent→childTaskIds index from the PRD item tree.
 * Only maps parent features/epics to their direct task/subtask children.
 */
function buildParentTaskIndex(items: PRDItem[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  function walk(item: PRDItem, parentId: string | null): void {
    const isTask = item.level === "task" || item.level === "subtask";
    if (isTask && parentId) {
      const siblings = index.get(parentId) ?? new Set();
      siblings.add(item.id);
      index.set(parentId, siblings);
    }
    if (item.children) {
      for (const child of item.children) {
        walk(child, item.id);
      }
    }
  }

  for (const item of items) {
    walk(item, null);
  }

  return index;
}

/**
 * Build a reverse index: zone ID → set of zone file paths.
 * Used for same-zone-but-different-files (low confidence) edge detection.
 */
function buildFileToZoneIndex(zones: ZoneIndex): Map<string, Set<string>> {
  const fileToZones = new Map<string, Set<string>>();
  for (const [zoneId, files] of zones) {
    for (const file of files) {
      const zoneSet = fileToZones.get(file) ?? new Set();
      zoneSet.add(zoneId);
      fileToZones.set(file, zoneSet);
    }
  }
  return fileToZones;
}

/**
 * Determine if two tasks share at least one zone via their blast radii.
 * Returns true if any file in taskA's radius and any file in taskB's radius
 * belong to the same zone.
 */
function tasksShareZone(
  radiusA: Set<string>,
  radiusB: Set<string>,
  fileToZones: Map<string, Set<string>>,
): boolean {
  // Collect zones from task A's files
  const zonesA = new Set<string>();
  for (const file of radiusA) {
    const zones = fileToZones.get(file);
    if (zones) {
      for (const z of zones) zonesA.add(z);
    }
  }
  if (zonesA.size === 0) return false;

  // Check if any of task B's files share a zone
  for (const file of radiusB) {
    const zones = fileToZones.get(file);
    if (zones) {
      for (const z of zones) {
        if (zonesA.has(z)) return true;
      }
    }
  }
  return false;
}

/**
 * Classify the confidence of an overlap between two blast radii.
 *
 * Priority:
 * 1. high  — direct file overlap (both tasks list the same file)
 * 2. medium — shared import neighborhood (files connected by 1-hop imports)
 * 3. low  — same zone but different files
 */
function classifyEdge(
  radiusA: Set<string>,
  radiusB: Set<string>,
  imports: ImportGraph,
  fileToZones: Map<string, Set<string>>,
): { confidence: ConflictConfidence; weight: number; overlappingFiles: Set<string> } | null {
  // Check for direct file overlap (high confidence)
  const directOverlap = setIntersection(radiusA, radiusB);
  if (directOverlap.size > 0) {
    return {
      confidence: "high",
      weight: directOverlap.size,
      overlappingFiles: directOverlap,
    };
  }

  // Check for shared import neighborhood (medium confidence)
  // Two tasks conflict at medium confidence if any file in A is a 1-hop
  // import neighbor of any file in B
  const neighborOverlap = new Set<string>();
  for (const fileA of radiusA) {
    const neighborsA = imports.get(fileA);
    if (!neighborsA) continue;
    for (const neighbor of neighborsA) {
      if (radiusB.has(neighbor)) {
        neighborOverlap.add(neighbor);
      }
    }
  }
  // Also check the reverse direction
  for (const fileB of radiusB) {
    const neighborsB = imports.get(fileB);
    if (!neighborsB) continue;
    for (const neighbor of neighborsB) {
      if (radiusA.has(neighbor)) {
        neighborOverlap.add(neighbor);
      }
    }
  }

  if (neighborOverlap.size > 0) {
    return {
      confidence: "medium",
      weight: neighborOverlap.size,
      overlappingFiles: neighborOverlap,
    };
  }

  // Check for same-zone proximity (low confidence)
  if (tasksShareZone(radiusA, radiusB, fileToZones)) {
    // Weight is 1 for zone-only overlap (structural, not file-level)
    // Report overlapping files as the union of files from shared zones
    const sharedZoneFiles = new Set<string>();
    const zonesA = new Set<string>();
    for (const file of radiusA) {
      const zones = fileToZones.get(file);
      if (zones) for (const z of zones) zonesA.add(z);
    }
    for (const file of radiusB) {
      const zones = fileToZones.get(file);
      if (zones) {
        for (const z of zones) {
          if (zonesA.has(z)) sharedZoneFiles.add(file);
        }
      }
    }
    return {
      confidence: "low",
      weight: 1,
      overlappingFiles: sharedZoneFiles,
    };
  }

  return null;
}

// ── Conflict graph construction ──────────────────────────────────────────────

/**
 * Build a conflict graph from pre-computed blast radii.
 *
 * Nodes are task IDs (keys in blastRadii). Edges connect tasks whose
 * blast radii overlap. Edge weight = number of overlapping files.
 * Each edge is classified by confidence level.
 *
 * @param blastRadii - Map of task ID → set of files in the blast radius.
 * @param imports - Import graph for medium-confidence edge detection.
 * @param zones - Zone index for low-confidence edge detection.
 * @returns Adjacency list with weighted, classified edges.
 */
export function buildConflictGraph(
  blastRadii: Map<string, Set<string>>,
  imports: ImportGraph = new Map(),
  zones: ZoneIndex = new Map(),
): ConflictGraph {
  const graph: ConflictGraph = new Map();
  const taskIds = [...blastRadii.keys()];
  const fileToZones = buildFileToZoneIndex(zones);

  // Initialize adjacency lists
  for (const id of taskIds) {
    graph.set(id, []);
  }

  // Compare all pairs (i, j) where i < j to avoid duplicates
  for (let i = 0; i < taskIds.length; i++) {
    for (let j = i + 1; j < taskIds.length; j++) {
      const idA = taskIds[i];
      const idB = taskIds[j];
      const radiusA = blastRadii.get(idA)!;
      const radiusB = blastRadii.get(idB)!;

      // Skip if either task has an empty blast radius
      if (radiusA.size === 0 || radiusB.size === 0) continue;

      const edge = classifyEdge(radiusA, radiusB, imports, fileToZones);
      if (edge) {
        const overlappingSample = sampleSet(edge.overlappingFiles, 5);

        graph.get(idA)!.push({
          targetId: idB,
          weight: edge.weight,
          confidence: edge.confidence,
          overlappingFiles: overlappingSample,
        });
        graph.get(idB)!.push({
          targetId: idA,
          weight: edge.weight,
          confidence: edge.confidence,
          overlappingFiles: overlappingSample,
        });
      }
    }
  }

  return graph;
}

// ── Independent set detection ────────────────────────────────────────────────

/**
 * Collect tasks that have explicit blockedBy dependencies within the
 * actionable task set. These tasks must run sequentially.
 */
function collectSerialTasks(
  taskIds: Set<string>,
  items: PRDItem[],
): Set<string> {
  const serial = new Set<string>();

  function walk(item: PRDItem): void {
    if (
      (item.level === "task" || item.level === "subtask") &&
      taskIds.has(item.id)
    ) {
      if (item.blockedBy && item.blockedBy.length > 0) {
        // If any blocker is also in the actionable set, both are serial
        for (const blockerId of item.blockedBy) {
          if (taskIds.has(blockerId)) {
            serial.add(item.id);
            serial.add(blockerId);
          }
        }
      }
    }
    if (item.children) {
      for (const child of item.children) {
        walk(child);
      }
    }
  }

  for (const item of items) {
    walk(item);
  }

  return serial;
}

/**
 * Build a set of task ID pairs that share a parent feature.
 * These pairs are conservatively forced into the same group.
 */
function collectSiblingPairs(
  taskIds: Set<string>,
  items: PRDItem[],
): Map<string, Set<string>> {
  const parentIndex = buildParentTaskIndex(items);
  const siblingGroups = new Map<string, Set<string>>();

  for (const [_parentId, childIds] of parentIndex) {
    // Filter to only include actionable task IDs
    const actionableSiblings = new Set<string>();
    for (const childId of childIds) {
      if (taskIds.has(childId)) {
        actionableSiblings.add(childId);
      }
    }

    // If 2+ siblings are actionable, they should be in the same group
    if (actionableSiblings.size >= 2) {
      for (const id of actionableSiblings) {
        const existing = siblingGroups.get(id) ?? new Set();
        for (const otherId of actionableSiblings) {
          if (otherId !== id) existing.add(otherId);
        }
        siblingGroups.set(id, existing);
      }
    }
  }

  return siblingGroups;
}

/**
 * Find independent sets via greedy graph coloring.
 *
 * Uses a greedy approach: process nodes in order of decreasing degree
 * (most constrained first), assign each node the smallest color that
 * doesn't conflict with its already-colored neighbors.
 *
 * Respects additional constraints:
 * - Serial tasks (blockedBy within actionable set) are excluded from groups.
 * - Sibling tasks (sharing a parent feature) are forced into the same color.
 *
 * @param graph - The conflict graph (adjacency list).
 * @param items - The PRD item tree (for blockedBy and parent lookups).
 * @param blastRadii - Blast radii for estimated size computation.
 * @returns ExecutionPlan with groups, serial tasks, and conflicts.
 */
export function findIndependentSets(
  graph: ConflictGraph,
  items: PRDItem[],
  blastRadii: Map<string, Set<string>>,
): ExecutionPlan {
  const allTaskIds = new Set(graph.keys());

  // Step 1: Identify serial tasks (blockedBy within actionable set)
  const serialTaskIds = collectSerialTasks(allTaskIds, items);

  // Step 2: Identify sibling constraints
  const siblingPairs = collectSiblingPairs(allTaskIds, items);

  // Step 3: Build augmented adjacency — add virtual edges for sibling constraints
  // Siblings are NOT conflict edges; they are soft constraints for coloring.
  // We handle them by forcing the same color assignment.

  // Step 4: Greedy graph coloring
  // Exclude serial tasks from coloring — they run sequentially
  const colorable = [...allTaskIds].filter((id) => !serialTaskIds.has(id));

  // Sort by degree descending (most constrained first) for better coloring
  colorable.sort((a, b) => {
    const degA = (graph.get(a) ?? []).length;
    const degB = (graph.get(b) ?? []).length;
    return degB - degA;
  });

  // Union-Find for sibling groups (forced same color)
  const parent = new Map<string, string>();
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) {
      parent.set(x, find(parent.get(x)!));
    }
    return parent.get(x)!;
  }
  function union(x: string, y: string): void {
    const px = find(x);
    const py = find(y);
    if (px !== py) parent.set(px, py);
  }

  // Union sibling pairs
  for (const [id, siblings] of siblingPairs) {
    if (!serialTaskIds.has(id)) {
      for (const sibId of siblings) {
        if (!serialTaskIds.has(sibId)) {
          union(id, sibId);
        }
      }
    }
  }

  // Group colorable nodes by their union-find representative
  const representativeGroups = new Map<string, string[]>();
  for (const id of colorable) {
    const rep = find(id);
    const group = representativeGroups.get(rep) ?? [];
    group.push(id);
    representativeGroups.set(rep, group);
  }

  // Color assignment: assign to representative, propagate to group members
  const colorOf = new Map<string, number>();

  // Process representatives in degree order
  const representatives = [...representativeGroups.keys()].sort((a, b) => {
    // Use max degree among group members
    const maxDegA = Math.max(
      ...(representativeGroups.get(a) ?? []).map(
        (id) => (graph.get(id) ?? []).length,
      ),
    );
    const maxDegB = Math.max(
      ...(representativeGroups.get(b) ?? []).map(
        (id) => (graph.get(id) ?? []).length,
      ),
    );
    return maxDegB - maxDegA;
  });

  for (const rep of representatives) {
    const groupMembers = representativeGroups.get(rep)!;

    // Collect all colors used by neighbors of any group member
    const usedColors = new Set<number>();
    for (const memberId of groupMembers) {
      const edges = graph.get(memberId) ?? [];
      for (const edge of edges) {
        const neighborColor = colorOf.get(edge.targetId);
        if (neighborColor !== undefined) {
          usedColors.add(neighborColor);
        }
      }
    }

    // Find smallest available color
    let color = 0;
    while (usedColors.has(color)) color++;

    // Assign color to all group members
    for (const memberId of groupMembers) {
      colorOf.set(memberId, color);
    }
  }

  // Step 5: Build groups from color assignments
  const colorGroups = new Map<number, string[]>();
  for (const [id, color] of colorOf) {
    const group = colorGroups.get(color) ?? [];
    group.push(id);
    colorGroups.set(color, group);
  }

  // Build TaskGroup objects and sort by estimated size (largest first)
  const groups: TaskGroup[] = [...colorGroups.entries()]
    .map(([_color, taskIds]) => ({
      index: 0, // will be re-assigned after sorting
      taskIds,
      estimatedSize: taskIds.reduce(
        (sum, id) => sum + (blastRadii.get(id)?.size ?? 0),
        0,
      ),
    }))
    .sort((a, b) => b.estimatedSize - a.estimatedSize)
    .map((group, i) => ({ ...group, index: i }));

  // Step 6: Collect all conflicts from the graph (deduplicated)
  const conflicts: Conflict[] = [];
  const seenPairs = new Set<string>();
  for (const [taskId, edges] of graph) {
    for (const edge of edges) {
      const pairKey =
        taskId < edge.targetId
          ? `${taskId}:${edge.targetId}`
          : `${edge.targetId}:${taskId}`;
      if (!seenPairs.has(pairKey)) {
        seenPairs.add(pairKey);
        conflicts.push({
          taskA: taskId < edge.targetId ? taskId : edge.targetId,
          taskB: taskId < edge.targetId ? edge.targetId : taskId,
          weight: edge.weight,
          confidence: edge.confidence,
          overlappingFiles: edge.overlappingFiles,
        });
      }
    }
  }

  return {
    groups,
    serialTasks: [...serialTaskIds],
    conflicts,
  };
}
