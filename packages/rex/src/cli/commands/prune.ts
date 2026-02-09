import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { resolveStore } from "../../store/index.js";
import { findPrunableItems, pruneItems } from "../../core/prune.js";
import { applyReshape } from "../../core/reshape.js";
import type { ReshapeProposal } from "../../core/reshape.js";
import { toCanonicalJSON } from "../../core/canonical.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";
import { formatTokenUsage } from "./analyze.js";
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
  source?: "prune" | "reshape";
  items: PRDItem[];
  count: number;
  reason?: string;
  actions?: ReshapeProposal[];
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
  const smart = flags.smart === "true";

  if (smart) {
    await smartPrune(dir, flags);
    return;
  }

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
    source: "prune",
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

/**
 * Smart prune: LLM-assisted identification of obsolete/mergeable items.
 * Delegates to reshape-reason with a prune-focused prompt, then applies
 * via applyReshape().
 */
async function smartPrune(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  if (doc.items.length === 0) {
    throw new CLIError(
      "PRD is empty — nothing to prune.",
      "Run 'rex analyze' first to build your PRD.",
    );
  }

  // Load Claude config
  const { setClaudeConfig } = await import("../../analyze/reason.js");
  const { loadClaudeConfig } = await import("../../store/project-config.js");
  const claudeConfig = await loadClaudeConfig(rexDir);
  setClaudeConfig(claudeConfig);

  const { reasonForReshape, formatReshapeProposal } = await import("../../analyze/reshape-reason.js");

  const dryRun = flags["dry-run"] === "true";
  const accept = flags.accept === "true";
  const model = flags.model;

  info("Analyzing PRD for pruning opportunities...");
  const { proposals, tokenUsage } = await reasonForReshape(doc.items, {
    dir,
    model,
    pruneMode: true,
  });

  const usageLine = formatTokenUsage(tokenUsage);
  if (usageLine) {
    info(`Token usage: ${usageLine}`);
  }

  if (proposals.length === 0) {
    result("No smart prune candidates found.");
    return;
  }

  info(`\nFound ${proposals.length} prune candidate${proposals.length === 1 ? "" : "s"}:\n`);
  for (let i = 0; i < proposals.length; i++) {
    info(`${i + 1}. ${formatReshapeProposal(proposals[i], doc.items)}`);
    info("");
  }

  if (dryRun) {
    if (flags.format === "json") {
      result(JSON.stringify({
        dryRun: true,
        proposals: proposals.map((p) => ({ id: p.id, ...p.action })),
        tokenUsage,
      }, null, 2));
    } else {
      result(`${proposals.length} prune candidate${proposals.length === 1 ? "" : "s"} (dry run — no changes made).`);
    }
    return;
  }

  // Determine which to apply
  let accepted: ReshapeProposal[];
  if (accept) {
    accepted = proposals;
  } else if (process.stdin.isTTY) {
    accepted = await interactiveSmartPrune(proposals, doc.items);
  } else {
    info("Run with --accept to apply, or use interactively in a TTY.");
    return;
  }

  if (accepted.length === 0) {
    result("No prune candidates accepted.");
    return;
  }

  // Apply via reshape
  const reshapeResult = applyReshape(doc.items, accepted);

  for (const err of reshapeResult.errors) {
    info(`  Warning: ${err.error}`);
  }

  // Archive
  if (reshapeResult.archivedItems.length > 0) {
    const archivePath = join(rexDir, ARCHIVE_FILE);
    const archive = await loadArchive(archivePath);
    archive.batches.push({
      timestamp: new Date().toISOString(),
      source: "reshape",
      items: reshapeResult.archivedItems,
      count: reshapeResult.archivedItems.length,
      reason: "Smart prune: LLM-identified obsolete/mergeable items",
      actions: accepted,
    });
    await writeFile(archivePath, toCanonicalJSON(archive), "utf-8");
  }

  await store.saveDocument(doc);

  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "smart_prune",
    detail: JSON.stringify({
      applied: reshapeResult.applied.length,
      deleted: reshapeResult.deletedIds.length,
      actions: reshapeResult.applied.map((p) => p.action.action),
    }),
  });

  if (flags.format === "json") {
    result(JSON.stringify({
      applied: reshapeResult.applied.length,
      deletedIds: reshapeResult.deletedIds,
      archivedCount: reshapeResult.archivedItems.length,
    }, null, 2));
  } else {
    result(`Smart-pruned ${reshapeResult.applied.length} item${reshapeResult.applied.length === 1 ? "" : "s"}.`);
    if (reshapeResult.archivedItems.length > 0) {
      info(`  ${reshapeResult.archivedItems.length} item${reshapeResult.archivedItems.length === 1 ? "" : "s"} archived.`);
    }
  }
}

async function interactiveSmartPrune(
  proposals: ReshapeProposal[],
  items: PRDItem[],
): Promise<ReshapeProposal[]> {
  const { formatReshapeProposal } = await import("../../analyze/reshape-reason.js");
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  const accepted: ReshapeProposal[] = [];

  try {
    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      info(`\n[${i + 1}/${proposals.length}] ${formatReshapeProposal(p, items)}`);
      const answer = await ask("  Prune? (y/n/a=all/q=quit) ");
      const choice = answer.trim().toLowerCase();

      if (choice === "q") break;
      if (choice === "a") {
        accepted.push(...proposals.slice(i));
        break;
      }
      if (choice === "y" || choice === "yes") {
        accepted.push(p);
      }
    }
  } finally {
    rl.close();
  }

  return accepted;
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
