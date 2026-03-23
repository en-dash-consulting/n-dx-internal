import type { TaskBrief } from "../../schema/index.js";
import { subsection, stream, detail } from "../../types/output.js";

export type SelectionReason = "auto" | "explicit" | "interactive";

/**
 * Display task information before any work begins.
 * Shows task ID, title, priority, parent chain, acceptance criteria count,
 * and why this task was selected (auto-selected by priority, explicit ID,
 * or interactive selection).
 */
export function displayTaskInfo(brief: TaskBrief, reason?: SelectionReason): void {
  subsection("Task");

  stream("Task", `${brief.task.title}`);
  detail(`ID: ${brief.task.id}`);

  if (brief.task.priority) {
    detail(`Priority: ${brief.task.priority}`);
  }

  if (reason === "auto") {
    detail("Selected: auto (highest priority)");
  }

  if (brief.parentChain.length > 0) {
    const chain = brief.parentChain.map((p) => p.title).join(" → ");
    detail(`Context: ${chain}`);
  }

  if (brief.task.acceptanceCriteria && brief.task.acceptanceCriteria.length > 0) {
    detail(`Acceptance criteria: ${brief.task.acceptanceCriteria.length}`);
  }
}
