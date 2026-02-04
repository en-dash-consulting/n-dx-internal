import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { resolveStore } from "../../store/index.js";
import { findPrunableItems, pruneItems } from "../../core/prune.js";
import { toCanonicalJSON } from "../../core/canonical.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";
import type { PRDItem } from "../../schema/index.js";

const ARCHIVE_FILE = "archive.json";

/**
 * Archive structure written to `.rex/archive.json`.
 *
 * Each prune run appends a batch to the archive's `batches` array,
 * preserving a timestamped history of all pruned subtrees.
 */
interface PruneArchive {
  schema: "rex/archive/v1";
  batches: PruneBatch[];
}

interface PruneBatch {
  timestamp: string;
  items: PRDItem[];
  count: number;
}

async function loadArchive(archivePath: string): Promise<PruneArchive> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(archivePath, "utf-8");
    return JSON.parse(raw) as PruneArchive;
  } catch {
    return { schema: "rex/archive/v1", batches: [] };
  }
}

export async function cmdPrune(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  const dryRun = flags["dry-run"] === "true";

  if (dryRun) {
    // Preview mode — show what would be pruned without mutating.
    const prunable = findPrunableItems(doc.items);
    if (prunable.length === 0) {
      result("Nothing to prune.");
      return;
    }

    if (flags.format === "json") {
      result(JSON.stringify({
        dryRun: true,
        items: prunable.map(summarize),
      }, null, 2));
    } else {
      result("Would prune:");
      for (const item of prunable) {
        result(`  ${icon(item.level)} ${item.title} (${item.id.slice(0, 8)})`);
      }
    }
    return;
  }

  // Prune completed subtrees
  const pruneResult = pruneItems(doc.items);

  if (pruneResult.prunedCount === 0) {
    result("Nothing to prune.");
    return;
  }

  // Archive pruned items
  const archivePath = join(rexDir, ARCHIVE_FILE);
  const archive = await loadArchive(archivePath);
  archive.batches.push({
    timestamp: new Date().toISOString(),
    items: pruneResult.pruned,
    count: pruneResult.prunedCount,
  });
  await writeFile(archivePath, toCanonicalJSON(archive), "utf-8");

  // Persist the pruned document
  await store.saveDocument(doc);

  // Log the prune action
  const titles = pruneResult.pruned.map((i) => i.title).join(", ");
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "items_pruned",
    detail: `Pruned ${pruneResult.prunedCount} completed items: ${titles}`,
  });

  // Output results
  if (flags.format === "json") {
    result(JSON.stringify({
      pruned: pruneResult.pruned.map(summarize),
      prunedCount: pruneResult.prunedCount,
      archivePath,
    }, null, 2));
  } else {
    result(`Pruned ${pruneResult.prunedCount} completed item${pruneResult.prunedCount === 1 ? "" : "s"}:`);
    for (const item of pruneResult.pruned) {
      result(`  ${icon(item.level)} ${item.title}`);
    }
    info(`Archived to ${ARCHIVE_FILE}`);
  }
}

function summarize(item: PRDItem): { id: string; title: string; level: string } {
  return { id: item.id, title: item.title, level: item.level };
}

function icon(level: string): string {
  switch (level) {
    case "epic": return "📦";
    case "feature": return "✨";
    case "task": return "📋";
    case "subtask": return "🔹";
    default: return "•";
  }
}
