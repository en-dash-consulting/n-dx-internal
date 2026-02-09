import type { TaskBrief } from "../../schema/index.js";
import { subsection, stream, detail } from "../../types/output.js";

/**
 * Display task information before any work begins.
 * Shows task ID, title, priority, parent chain, and acceptance criteria count.
 * This gives the user immediate visibility into what the agent will work on.
 */
export function displayTaskInfo(brief: TaskBrief): void {
  subsection("Task");

  stream("Task", `${brief.task.title}`);
  detail(`ID: ${brief.task.id}`);

  if (brief.task.priority) {
    detail(`Priority: ${brief.task.priority}`);
  }

  if (brief.parentChain.length > 0) {
    const chain = brief.parentChain.map((p) => p.title).join(" → ");
    detail(`Context: ${chain}`);
  }

  if (brief.task.acceptanceCriteria && brief.task.acceptanceCriteria.length > 0) {
    detail(`Acceptance criteria: ${brief.task.acceptanceCriteria.length}`);
  }
}
