import { randomUUID } from "node:crypto";
import type { PRDStore } from "rex/dist/store/types.js";
import type { ItemStatus } from "rex/dist/schema/v1.js";
import { computeTimestampUpdates } from "rex/dist/core/timestamps.js";

export async function toolRexUpdateStatus(
  store: PRDStore,
  taskId: string,
  params: { status: string },
): Promise<string> {
  const validStatuses = ["pending", "in_progress", "completed", "deferred"];
  if (!validStatuses.includes(params.status)) {
    throw new Error(
      `Invalid status "${params.status}". Valid: ${validStatuses.join(", ")}`,
    );
  }

  const existing = await store.getItem(taskId);
  const tsUpdates = computeTimestampUpdates(
    existing?.status ?? "pending",
    params.status as ItemStatus,
    existing ?? undefined,
  );
  await store.updateItem(taskId, { status: params.status as ItemStatus, ...tsUpdates });
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "status_updated",
    itemId: taskId,
    detail: `Status changed to ${params.status} by hench agent`,
  });

  return `Updated task ${taskId} status to ${params.status}`;
}

export async function toolRexAppendLog(
  store: PRDStore,
  taskId: string,
  params: { event: string; detail?: string },
): Promise<string> {
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: params.event,
    itemId: taskId,
    detail: params.detail,
  });

  return `Logged event: ${params.event}`;
}

export async function toolRexAddSubtask(
  store: PRDStore,
  taskId: string,
  params: { title: string; description?: string; priority?: string },
): Promise<string> {
  const validPriorities = ["critical", "high", "medium", "low"];
  if (params.priority && !validPriorities.includes(params.priority)) {
    throw new Error(
      `Invalid priority "${params.priority}". Valid: ${validPriorities.join(", ")}`,
    );
  }

  const id = randomUUID();
  const subtask = {
    id,
    title: params.title,
    status: "pending" as ItemStatus,
    level: "subtask" as const,
    description: params.description,
    priority: params.priority as "critical" | "high" | "medium" | "low" | undefined,
  };

  await store.addItem(subtask, taskId);
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "subtask_added",
    itemId: id,
    detail: `Added subtask "${params.title}" under ${taskId}`,
  });

  return `Created subtask ${id}: ${params.title}`;
}
