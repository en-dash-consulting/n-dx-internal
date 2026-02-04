import { join } from "node:path";
import { createStore } from "../../store/index.js";
import { findNextTask, collectCompletedIds } from "../../core/next-task.js";
import { REX_DIR } from "./constants.js";

export async function cmdNext(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = createStore("file", rexDir);
  const doc = await store.loadDocument();

  if (doc.items.length === 0) {
    console.log("No items in PRD. Run: rex add epic --title=\"...\" " + dir);
    return;
  }

  const completedIds = collectCompletedIds(doc.items);
  const result = findNextTask(doc.items, completedIds);

  if (!result) {
    console.log("COMPLETE — no actionable tasks remaining");
    return;
  }

  const { item, parents } = result;

  if (flags.format === "json") {
    console.log(JSON.stringify({ item, parents }, null, 2));
    return;
  }

  if (parents.length > 0) {
    const breadcrumb = parents.map((p) => p.title).join(" → ");
    console.log(`${breadcrumb} →`);
  }

  console.log(`\n[${item.level}] ${item.title}`);
  console.log(`  ID:     ${item.id}`);
  console.log(`  Status: ${item.status}`);
  if (item.priority) console.log(`  Priority: ${item.priority}`);
  if (item.description) console.log(`\n  ${item.description}`);
  if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
    console.log("\n  Acceptance Criteria:");
    for (const ac of item.acceptanceCriteria) {
      console.log(`    - ${ac}`);
    }
  }
}
