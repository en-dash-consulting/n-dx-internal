import { join } from "node:path";
import { createStore } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import type { PRDItem, ItemStatus, Priority } from "../../schema/index.js";

const VALID_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "deferred",
]);
const VALID_PRIORITIES = new Set(["critical", "high", "medium", "low"]);

export async function cmdUpdate(
  dir: string,
  id: string,
  flags: Record<string, string>,
): Promise<void> {
  if (!id) {
    console.error("Missing item ID. Usage: rex update <id> [options]");
    process.exit(1);
  }

  const rexDir = join(dir, REX_DIR);
  const store = createStore("file", rexDir);

  const existing = await store.getItem(id);
  if (!existing) {
    console.error(`Item "${id}" not found.`);
    process.exit(1);
  }

  const updates: Partial<PRDItem> = {};

  if (flags.status) {
    if (!VALID_STATUSES.has(flags.status)) {
      console.error(
        `Invalid status "${flags.status}". Must be one of: ${[...VALID_STATUSES].join(", ")}`,
      );
      process.exit(1);
    }
    updates.status = flags.status as ItemStatus;
  }

  if (flags.priority) {
    if (!VALID_PRIORITIES.has(flags.priority)) {
      console.error(
        `Invalid priority "${flags.priority}". Must be one of: ${[...VALID_PRIORITIES].join(", ")}`,
      );
      process.exit(1);
    }
    updates.priority = flags.priority as Priority;
  }

  if (flags.title) updates.title = flags.title;
  if (flags.description) updates.description = flags.description;

  if (Object.keys(updates).length === 0) {
    console.error("No updates specified. Use --status, --priority, --title, or --description.");
    process.exit(1);
  }

  await store.updateItem(id, updates);

  // Log the update
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "item_updated",
    itemId: id,
    detail: `Updated: ${Object.keys(updates).join(", ")}`,
  });

  if (flags.format === "json") {
    const updated = await store.getItem(id);
    console.log(JSON.stringify(updated, null, 2));
  } else {
    console.log(`Updated ${existing.level}: ${existing.title}`);
    for (const [key, value] of Object.entries(updates)) {
      console.log(`  ${key}: ${value}`);
    }
  }
}
