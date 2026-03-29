/**
 * Execution plan formatter for parallel worktree execution.
 *
 * Orchestrates the full pipeline: load PRD, compute blast radii,
 * build conflict graph, find independent sets, and format the
 * resulting execution plan as human-readable text or JSON.
 *
 * @module rex/parallel/execution-plan
 */

import type { PRDItem } from "../schema/v1.js";
import type { ZoneIndex, ImportGraph } from "./blast-radius.js";
import { blastRadius } from "./blast-radius.js";
import {
  buildConflictGraph,
  findIndependentSets,
} from "./conflict-analysis.js";
import type { ExecutionPlan, Conflict, TaskGroup } from "./conflict-analysis.js";

// ── Public types ─────────────────────────────────────────────────────────────

/** Full execution plan with metadata for display. */
export interface FormattedExecutionPlan extends ExecutionPlan {
  /** Total number of actionable tasks analyzed. */
  totalTasks: number;
  /** Maximum parallelism achievable (largest group size). */
  maxParallelism: number;
  /** Task metadata lookup: id → { title, priority }. */
  taskMeta: Record<string, { title: string; priority?: string }>;
}

// ── Core pipeline ────────────────────────────────────────────────────────────

/**
 * Compute the full execution plan from PRD items and sourcevision data.
 *
 * Pipeline:
 * 1. Collect actionable tasks (pending or in_progress, not blocked).
 * 2. Compute blast radii for each task.
 * 3. Build conflict graph from blast radii.
 * 4. Find independent sets (parallel-safe groups).
 * 5. Attach metadata for display.
 *
 * @param items - The PRD item tree (root items array).
 * @param zones - Zone index from sourcevision (zone ID → file set).
 * @param imports - Import graph from sourcevision (file → neighbors).
 * @returns FormattedExecutionPlan with groups, conflicts, and metadata.
 */
export function computeExecutionPlan(
  items: PRDItem[],
  zones: ZoneIndex,
  imports: ImportGraph,
): FormattedExecutionPlan {
  // Step 1: Collect actionable tasks
  const actionable = collectActionableTasks(items);

  if (actionable.length === 0) {
    return {
      groups: [],
      serialTasks: [],
      conflicts: [],
      totalTasks: 0,
      maxParallelism: 0,
      taskMeta: {},
    };
  }

  // Build task metadata lookup
  const taskMeta: Record<string, { title: string; priority?: string }> = {};
  for (const task of actionable) {
    taskMeta[task.id] = { title: task.title, priority: task.priority };
  }

  // Step 2: Compute blast radii
  const radii = blastRadius(items, zones, imports);

  // Filter radii to only actionable task IDs
  const actionableIds = new Set(actionable.map((t) => t.id));
  const filteredRadii = new Map<string, Set<string>>();
  for (const [id, files] of radii) {
    if (actionableIds.has(id)) {
      filteredRadii.set(id, files);
    }
  }

  // Ensure all actionable tasks have an entry (even if empty radius)
  for (const task of actionable) {
    if (!filteredRadii.has(task.id)) {
      filteredRadii.set(task.id, new Set());
    }
  }

  // Step 3: Build conflict graph
  const graph = buildConflictGraph(filteredRadii, imports, zones);

  // Step 4: Find independent sets
  const plan = findIndependentSets(graph, items, filteredRadii);

  // Step 5: Compute max parallelism
  const maxParallelism = plan.groups.reduce(
    (max, g) => Math.max(max, g.taskIds.length),
    0,
  );

  return {
    ...plan,
    totalTasks: actionable.length,
    maxParallelism,
    taskMeta,
  };
}

// ── Actionable task collection ───────────────────────────────────────────────

/** Statuses that indicate a task is actionable. */
const ACTIONABLE_STATUSES = new Set(["pending", "in_progress"]);

/**
 * Collect all actionable tasks from the PRD tree.
 * A task is actionable if it is a task or subtask with a pending or in_progress status,
 * and all its blockedBy dependencies are completed.
 */
function collectActionableTasks(items: PRDItem[]): PRDItem[] {
  const completedIds = new Set<string>();
  collectCompletedIdsHelper(items, completedIds);

  const actionable: PRDItem[] = [];

  function walk(item: PRDItem): void {
    if (
      (item.level === "task" || item.level === "subtask") &&
      ACTIONABLE_STATUSES.has(item.status)
    ) {
      // Check if all blockers are completed
      const blocked = item.blockedBy?.some((id) => !completedIds.has(id));
      if (!blocked) {
        actionable.push(item);
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
  return actionable;
}

/** Collect IDs of all completed items. */
function collectCompletedIdsHelper(items: PRDItem[], result: Set<string>): void {
  for (const item of items) {
    if (item.status === "completed") {
      result.add(item.id);
    }
    if (item.children) {
      collectCompletedIdsHelper(item.children, result);
    }
  }
}

// ── Human-readable formatting ────────────────────────────────────────────────

/**
 * Format an execution plan as human-readable text.
 *
 * Output structure:
 *   Execution Plan
 *   ══════════════
 *   N actionable tasks → M groups (max parallelism: P)
 *
 *   Group 1 (N tasks, ~X files)
 *   ─────────────────────────
 *     • [task] Title (id)
 *
 *   Conflicts (N detected)
 *   ──────────────────────
 *     task-a ↔ task-b [high] 5 overlapping files
 *       src/foo.ts, src/bar.ts, ...
 *
 *   Serial Tasks (N)
 *   ────────────────
 *     • Title (id) — blocked by: dep-id
 */
export function formatExecutionPlan(plan: FormattedExecutionPlan): string {
  const lines: string[] = [];

  lines.push("Execution Plan");
  lines.push("══════════════");

  if (plan.totalTasks === 0) {
    lines.push("");
    lines.push("No actionable tasks found.");
    lines.push("");
    lines.push("All tasks are either completed, blocked, or deferred.");
    return lines.join("\n");
  }

  // Summary line
  const groupCount = plan.groups.length;
  const serialCount = plan.serialTasks.length;
  lines.push("");
  lines.push(
    `${plan.totalTasks} actionable task${plan.totalTasks === 1 ? "" : "s"} → ` +
    `${groupCount} group${groupCount === 1 ? "" : "s"} ` +
    `(max parallelism: ${plan.maxParallelism})`,
  );

  if (serialCount > 0) {
    lines.push(`${serialCount} task${serialCount === 1 ? "" : "s"} must run sequentially`);
  }

  // Groups
  for (const group of plan.groups) {
    lines.push("");
    lines.push(
      `Group ${group.index + 1} (${group.taskIds.length} task${group.taskIds.length === 1 ? "" : "s"}, ~${group.estimatedSize} files)`,
    );
    lines.push("─".repeat(40));
    for (const taskId of group.taskIds) {
      const meta = plan.taskMeta[taskId];
      const label = meta ? meta.title : taskId;
      const priority = meta?.priority ? ` [${meta.priority}]` : "";
      lines.push(`  • ${label}${priority} (${truncateId(taskId)})`);
    }
  }

  // Conflicts
  if (plan.conflicts.length > 0) {
    lines.push("");
    lines.push(
      `Conflicts (${plan.conflicts.length} detected)`,
    );
    lines.push("─".repeat(40));
    for (const conflict of plan.conflicts) {
      lines.push(formatConflictLine(conflict, plan.taskMeta));
      if (conflict.overlappingFiles.length > 0) {
        const fileList = conflict.overlappingFiles.slice(0, 3).join(", ");
        const more = conflict.overlappingFiles.length > 3
          ? ` (+${conflict.overlappingFiles.length - 3} more)`
          : "";
        lines.push(`    ${fileList}${more}`);
      }
    }
  }

  // Serial tasks
  if (plan.serialTasks.length > 0) {
    lines.push("");
    lines.push(`Serial Tasks (${plan.serialTasks.length})`);
    lines.push("─".repeat(40));
    for (const taskId of plan.serialTasks) {
      const meta = plan.taskMeta[taskId];
      const label = meta ? meta.title : taskId;
      lines.push(`  • ${label} (${truncateId(taskId)})`);
    }
  }

  return lines.join("\n");
}

// ── Formatting helpers ───────────────────────────────────────────────────────

/** Format a single conflict line. */
function formatConflictLine(
  conflict: Conflict,
  taskMeta: Record<string, { title: string; priority?: string }>,
): string {
  const nameA = taskMeta[conflict.taskA]?.title ?? conflict.taskA;
  const nameB = taskMeta[conflict.taskB]?.title ?? conflict.taskB;
  const fileWord = conflict.weight === 1 ? "file" : "files";
  return `  ${truncateName(nameA)} ↔ ${truncateName(nameB)} [${conflict.confidence}] ${conflict.weight} overlapping ${fileWord}`;
}

/** Truncate a task name for display (max 30 chars). */
function truncateName(name: string): string {
  if (name.length <= 30) return name;
  return name.slice(0, 27) + "...";
}

/** Truncate a UUID-style ID for display (first 8 chars). */
function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return id.slice(0, 8) + "…";
}
