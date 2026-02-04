import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createStore } from "../../store/index.js";
import { LEVEL_HIERARCHY } from "../../schema/index.js";
import { findItem } from "../../core/tree.js";
import { REX_DIR } from "./constants.js";
import type { PRDItem, ItemLevel, ItemStatus, Priority } from "../../schema/index.js";

const VALID_LEVELS = new Set(Object.keys(LEVEL_HIERARCHY));

export async function cmdAdd(
  dir: string,
  level: string,
  flags: Record<string, string>,
): Promise<void> {
  if (!VALID_LEVELS.has(level)) {
    console.error(
      `Invalid level "${level}". Must be one of: ${[...VALID_LEVELS].join(", ")}`,
    );
    process.exit(1);
  }

  const title = flags.title;
  if (!title) {
    console.error('Missing required flag: --title="..."');
    process.exit(1);
  }

  const rexDir = join(dir, REX_DIR);
  const store = createStore("file", rexDir);
  const doc = await store.loadDocument();

  const parentId = flags.parent;

  // Validate parent-child level relationship
  const requiredParentLevel = LEVEL_HIERARCHY[level as ItemLevel];
  if (requiredParentLevel && !parentId) {
    console.error(
      `A ${level} requires a parent. Use --parent=<id> to specify a ${requiredParentLevel}.`,
    );
    process.exit(1);
  }

  if (parentId) {
    const parentEntry = findItem(doc.items, parentId);
    if (!parentEntry) {
      console.error(`Parent "${parentId}" not found.`);
      process.exit(1);
    }
    if (requiredParentLevel && parentEntry.item.level !== requiredParentLevel) {
      console.error(
        `A ${level} must be a child of a ${requiredParentLevel}, but "${parentId}" is a ${parentEntry.item.level}.`,
      );
      process.exit(1);
    }
  }

  if (!requiredParentLevel && parentId) {
    // epics can optionally have parents but it's unusual
  }

  const id = randomUUID();
  const item: PRDItem = {
    id,
    title,
    status: (flags.status as ItemStatus) ?? "pending",
    level: level as ItemLevel,
  };

  if (flags.description) item.description = flags.description;
  if (flags.priority) item.priority = flags.priority as Priority;

  await store.addItem(item, parentId);

  // Log the addition
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "item_added",
    itemId: id,
    detail: `Added ${level}: ${title}`,
  });

  if (flags.format === "json") {
    console.log(JSON.stringify({ id, level, title }, null, 2));
  } else {
    console.log(`Created ${level}: ${title}`);
    console.log(`  ID: ${id}`);
  }
}
