import { join } from "node:path";
import { createStore } from "../../store/index.js";
import { computeStats } from "../../core/tree.js";
import { REX_DIR } from "./constants.js";
import type { PRDItem } from "../../schema/index.js";
import type { TreeStats } from "../../core/tree.js";

const STATUS_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  deferred: "◌",
};

function printTree(items: PRDItem[], indent: number = 0): void {
  for (const item of items) {
    const icon = STATUS_ICONS[item.status] ?? "?";
    const prefix = "  ".repeat(indent);
    const priority = item.priority ? ` [${item.priority}]` : "";

    if (item.children && item.children.length > 0) {
      const stats = computeStats(item.children);
      console.log(
        `${prefix}${icon} ${item.title}${priority} [${stats.completed}/${stats.total}]`,
      );
      printTree(item.children, indent + 1);
    } else {
      console.log(`${prefix}${icon} ${item.title}${priority}`);
    }
  }
}

function formatStats(stats: TreeStats): string {
  const parts = [];
  if (stats.completed > 0) parts.push(`${stats.completed} completed`);
  if (stats.inProgress > 0) parts.push(`${stats.inProgress} in progress`);
  if (stats.pending > 0) parts.push(`${stats.pending} pending`);
  if (stats.deferred > 0) parts.push(`${stats.deferred} deferred`);
  const pct =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  return `${parts.join(", ")} — ${pct}% complete (${stats.completed}/${stats.total})`;
}

export async function cmdStatus(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = createStore("file", rexDir);
  const doc = await store.loadDocument();

  if (flags.format === "json") {
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  console.log(`PRD: ${doc.title}`);
  console.log("");

  if (doc.items.length === 0) {
    console.log("  No items yet. Run: rex add epic --title=\"...\" " + dir);
    return;
  }

  printTree(doc.items);

  const stats = computeStats(doc.items);
  console.log("");
  console.log(formatStats(stats));
}
