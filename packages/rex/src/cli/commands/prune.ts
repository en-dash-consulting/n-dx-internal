import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { resolveStore } from "../../store/index.js";
import { findPrunableItems, pruneItems, countSubtree } from "../../core/prune.js";
import { applyReshape } from "../../core/reshape.js";
import type { ReshapeProposal } from "../../core/reshape.js";
import { toCanonicalJSON } from "../../core/canonical.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";
import { formatTokenUsage } from "./analyze.js";
import type { PRDItem } from "../../schema/index.js";
import { getLevelEmoji, formatLevelSummary as formatLevels } from "../../schema/index.js";

const ARCHIVE_FILE = "archive.json";

/**
 * Maximum number of archive batches to retain.
 * Older batches are discarded when this limit is exceeded,
 * preventing unbounded growth of archive.json over time.
 */
const MAX_ARCHIVE_BATCHES = 100;

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

// ── Parsed flag helpers ──────────────────────────────────────────────

interface PruneFlags {
  dryRun: boolean;
  skipConsolidate: boolean;
  accept: boolean;
  autoConfirm: boolean;
  isJson: boolean;
  model?: string;
  format?: string;
  raw: Record<string, string>;
}

function parseFlags(flags: Record<string, string>): PruneFlags {
  return {
    dryRun: flags["dry-run"] === "true",
    skipConsolidate: flags["no-consolidate"] === "true",
    accept: flags.accept === "true",
    autoConfirm: flags.yes === "true" || flags.y === "true",
    isJson: flags.format === "json",
    model: flags.model,
    format: flags.format,
    raw: flags,
  };
}

// ── Archive I/O ──────────────────────────────────────────────────────

async function loadArchive(archivePath: string): Promise<PruneArchive> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(archivePath, "utf-8");
    return JSON.parse(raw) as PruneArchive;
  } catch {
    return { schema: "rex/archive/v1", batches: [] };
  }
}

/**
 * Trim archive to retain only the most recent batches.
 * Prevents unbounded growth of archive.json in long-running projects.
 */
function trimArchive(archive: PruneArchive, maxBatches: number = MAX_ARCHIVE_BATCHES): number {
  if (archive.batches.length <= maxBatches) return 0;
  const excess = archive.batches.length - maxBatches;
  archive.batches = archive.batches.slice(excess);
  return excess;
}

/**
 * Append a batch to the archive and persist to disk.
 */
async function appendArchiveBatch(
  rexDir: string,
  batch: PruneBatch,
): Promise<void> {
  const archivePath = join(rexDir, ARCHIVE_FILE);
  const archive = await loadArchive(archivePath);
  archive.batches.push(batch);
  trimArchive(archive);
  await writeFile(archivePath, toCanonicalJSON(archive), "utf-8");
}

// ── TTY interaction ──────────────────────────────────────────────────

/**
 * Ask a single yes/no question in a TTY. Returns true for "y"/"yes".
 */
async function confirmPrompt(question: string): Promise<boolean> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) =>
    rl.question(question, resolve),
  );
  rl.close();

  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
}

async function interactiveAcceptProposals(
  proposals: ReshapeProposal[],
  items: PRDItem[],
  promptLabel = "Accept",
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
      const answer = await ask(`  ${promptLabel}? (y/n/a=all/q=quit) `);
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

// ── Formatting ───────────────────────────────────────────────────────

/**
 * Format a pruning impact summary for interactive preview.
 *
 * Groups prunable items by level and shows individual/total counts.
 */
function formatPrunePreview(prunable: PRDItem[]): {
  lines: string[];
  totalItems: number;
  byLevel: Record<string, number>;
} {
  let totalItems = 0;
  const byLevel: Record<string, number> = {};

  const lines: string[] = [];
  for (const item of prunable) {
    const subtreeCount = countSubtree(item);
    totalItems += subtreeCount;
    byLevel[item.level] = (byLevel[item.level] || 0) + 1;

    const childInfo = subtreeCount > 1 ? ` (${subtreeCount} items including children)` : "";
    lines.push(`  ${icon(item.level)} ${item.title} [${item.id.slice(0, 8)}]${childInfo}`);
  }

  return { lines, totalItems, byLevel };
}

/**
 * Format a level summary like "2 epics, 3 tasks".
 */
function formatLevelSummary(byLevel: Record<string, number>): string {
  return formatLevels(byLevel);
}

function summarize(item: PRDItem): { id: string; title: string; level: string } {
  return { id: item.id, title: item.title, level: item.level };
}

function icon(level: string): string {
  return getLevelEmoji(level);
}

// ── LLM config loading ──────────────────────────────────────────────

/**
 * Load and configure LLM settings for reshape/consolidation operations.
 */
async function initLLMConfig(rexDir: string): Promise<void> {
  const { setLLMConfig, setClaudeConfig } = await import("../../analyze/reason.js");
  const { loadLLMConfig, loadClaudeConfig } = await import("../../store/project-config.js");
  const llmConfig = await loadLLMConfig(rexDir);
  setLLMConfig(llmConfig);
  const claudeConfig = await loadClaudeConfig(rexDir);
  setClaudeConfig(claudeConfig);
}

// ── Reshape application ─────────────────────────────────────────────

/**
 * Apply accepted reshape proposals, archive removed items, and persist.
 *
 * Shared by both smart prune and post-prune consolidation flows.
 */
async function applyAndPersistReshape(
  rexDir: string,
  store: Awaited<ReturnType<typeof resolveStore>>,
  doc: Awaited<ReturnType<Awaited<ReturnType<typeof resolveStore>>["loadDocument"]>>,
  accepted: ReshapeProposal[],
  opts: { archiveReason: string; logEvent: string },
): Promise<{ applied: number; archivedCount: number }> {
  const reshapeResult = applyReshape(doc.items, accepted);

  for (const err of reshapeResult.errors) {
    info(`  Warning: ${err.error}`);
  }

  // Archive any items removed during reshape
  if (reshapeResult.archivedItems.length > 0) {
    info("Archiving items...");
    await appendArchiveBatch(rexDir, {
      timestamp: new Date().toISOString(),
      source: "reshape",
      items: reshapeResult.archivedItems,
      count: reshapeResult.archivedItems.length,
      reason: opts.archiveReason,
      actions: accepted,
    });
  }

  // Save document
  info("Saving document...");
  await store.saveDocument(doc);

  // Log the action
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: opts.logEvent,
    detail: JSON.stringify({
      applied: reshapeResult.applied.length,
      deleted: reshapeResult.deletedIds.length,
      archived: reshapeResult.archivedItems.length,
      actions: reshapeResult.applied.map((p) => p.action.action),
    }),
  });

  return {
    applied: reshapeResult.applied.length,
    archivedCount: reshapeResult.archivedItems.length,
  };
}

// ── Dry-run consolidation preview ───────────────────────────────────

/**
 * Preview consolidation proposals without mutating the PRD.
 * Returns proposals and token usage for JSON output.
 */
async function previewConsolidation(
  dir: string,
  rexDir: string,
  items: PRDItem[],
  pf: PruneFlags,
): Promise<{
  proposals: ReshapeProposal[];
  tokenUsage?: import("../../schema/index.js").AnalyzeTokenUsage;
}> {
  await initLLMConfig(rexDir);
  const { reasonForReshape, formatReshapeProposal: fmtProposal } = await import("../../analyze/reshape-reason.js");

  if (!pf.isJson) {
    info("\nAnalyzing for consolidation opportunities...");
  }

  const consolidateResult = await reasonForReshape(items, {
    dir,
    model: pf.model,
    consolidateMode: true,
  });

  if (!pf.isJson) {
    const usageLine = formatTokenUsage(consolidateResult.tokenUsage);
    if (usageLine) info(`Token usage: ${usageLine}`);

    if (consolidateResult.proposals.length > 0) {
      info(`\nWould propose ${consolidateResult.proposals.length} consolidation action${consolidateResult.proposals.length === 1 ? "" : "s"}:\n`);
      for (let i = 0; i < consolidateResult.proposals.length; i++) {
        info(`${i + 1}. ${fmtProposal(consolidateResult.proposals[i], items)}`);
        info("");
      }
    } else {
      info("\nNo consolidation needed.");
    }
  }

  return {
    proposals: consolidateResult.proposals,
    tokenUsage: consolidateResult.tokenUsage,
  };
}

// ── Dry-run mode ─────────────────────────────────────────────────────

/**
 * Handle the --dry-run path: show what would be pruned and
 * optionally preview consolidation proposals.
 */
async function dryRunPrune(
  dir: string,
  rexDir: string,
  items: PRDItem[],
  pf: PruneFlags,
): Promise<void> {
  const prunable = findPrunableItems(items);
  const hasPrunable = prunable.length > 0;

  if (hasPrunable && !pf.isJson) {
    const preview = formatPrunePreview(prunable);
    result("Would prune:");
    for (const line of preview.lines) {
      result(line);
    }
    result("");
    result(`Impact: ${preview.totalItems} total item${preview.totalItems === 1 ? "" : "s"} (${formatLevelSummary(preview.byLevel)})`);
  } else if (!hasPrunable && !pf.isJson) {
    result("Nothing to prune.");
  }

  // Also preview consolidation proposals in dry-run
  let consolidationProposals: ReshapeProposal[] = [];
  let consolidationTokenUsage: import("../../schema/index.js").AnalyzeTokenUsage | undefined;
  if (!pf.skipConsolidate && items.length > 0) {
    try {
      const preview = await previewConsolidation(dir, rexDir, items, pf);
      consolidationProposals = preview.proposals;
      consolidationTokenUsage = preview.tokenUsage;
    } catch (err) {
      if (!pf.isJson) {
        info(`\nConsolidation preview skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (pf.isJson) {
    result(JSON.stringify({
      dryRun: true,
      items: hasPrunable ? prunable.map(summarize) : [],
      ...(hasPrunable ? { totalItems: formatPrunePreview(prunable).totalItems } : {}),
      ...(consolidationProposals.length > 0 ? {
        consolidation: {
          proposals: consolidationProposals.map((p) => ({ id: p.id, ...p.action })),
          ...(consolidationTokenUsage ? { tokenUsage: consolidationTokenUsage } : {}),
        },
      } : {}),
    }, null, 2));
  }
}

// ── Execute prune ────────────────────────────────────────────────────

/**
 * Execute the actual prune: remove completed subtrees, archive them,
 * and persist the document. Returns the prune result or null if nothing
 * was pruned.
 */
async function executePrune(
  rexDir: string,
  store: Awaited<ReturnType<typeof resolveStore>>,
  doc: Awaited<ReturnType<Awaited<ReturnType<typeof resolveStore>>["loadDocument"]>>,
  pf: PruneFlags,
): Promise<ReturnType<typeof pruneItems> | null> {
  const progress = (msg: string): void => { if (!pf.isJson) info(msg); };

  progress("Pruning completed subtrees...");
  const pruneResult = pruneItems(doc.items);

  if (pruneResult.prunedCount === 0) {
    return null;
  }

  // Archive pruned items
  progress("Archiving pruned items...");
  await appendArchiveBatch(rexDir, {
    timestamp: new Date().toISOString(),
    source: "prune",
    items: pruneResult.pruned,
    count: pruneResult.prunedCount,
  });

  // Persist the pruned document
  progress("Saving pruned document...");
  await store.saveDocument(doc);

  // Log the prune action
  const titles = pruneResult.pruned.map((i) => i.title).join(", ");
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "items_pruned",
    detail: `Pruned ${pruneResult.prunedCount} completed items: ${titles}`,
  });

  return pruneResult;
}

// ── Post-prune consolidation ─────────────────────────────────────────

/**
 * Post-prune consolidation: LLM-assisted regrouping of remaining items.
 * Analyzes the current PRD state and proposes restructuring to create
 * clean, logical groupings after completed items have been removed.
 *
 * Returns consolidation summary for JSON output, or undefined if skipped.
 */
async function consolidateAfterPrune(
  dir: string,
  rexDir: string,
  store: Awaited<ReturnType<typeof resolveStore>>,
  doc: Awaited<ReturnType<Awaited<ReturnType<typeof resolveStore>>["loadDocument"]>>,
  pf: PruneFlags,
): Promise<{ applied: number; archivedCount: number } | undefined> {
  try {
    await initLLMConfig(rexDir);
    const { reasonForReshape, formatReshapeProposal } = await import("../../analyze/reshape-reason.js");

    info("\nAnalyzing remaining items for consolidation...");
    const { proposals, tokenUsage } = await reasonForReshape(doc.items, {
      dir,
      model: pf.model,
      consolidateMode: true,
    });

    const usageLine = formatTokenUsage(tokenUsage);
    if (usageLine) info(`Token usage: ${usageLine}`);

    if (proposals.length === 0) {
      info("No consolidation needed.");
      return undefined;
    }

    info(`\nFound ${proposals.length} consolidation proposal${proposals.length === 1 ? "" : "s"}:\n`);
    for (let i = 0; i < proposals.length; i++) {
      info(`${i + 1}. ${formatReshapeProposal(proposals[i], doc.items)}`);
      info("");
    }

    // Determine which to apply
    let accepted: ReshapeProposal[];
    if (pf.accept) {
      accepted = proposals;
    } else if (process.stdin.isTTY) {
      accepted = await interactiveAcceptProposals(proposals, doc.items, "Consolidate");
    } else {
      info("Run with --accept to apply consolidation, or use interactively in a TTY.");
      return undefined;
    }

    if (accepted.length === 0) {
      info("No consolidation proposals accepted.");
      return undefined;
    }

    info("Applying consolidation...");
    const reshapeResult = await applyAndPersistReshape(rexDir, store, doc, accepted, {
      archiveReason: "Post-prune consolidation: LLM-proposed restructuring",
      logEvent: "post_prune_consolidation",
    });

    if (!pf.isJson) {
      result(`Consolidated ${reshapeResult.applied} item${reshapeResult.applied === 1 ? "" : "s"}.`);
      if (reshapeResult.archivedCount > 0) {
        info(`  ${reshapeResult.archivedCount} item${reshapeResult.archivedCount === 1 ? "" : "s"} archived.`);
      }
    }

    return reshapeResult;
  } catch (err) {
    info(`\nConsolidation skipped: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

// ── Main entry points ────────────────────────────────────────────────

export async function cmdPrune(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  if (flags.smart === "true") {
    await smartPrune(dir, flags);
    return;
  }

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();
  const pf = parseFlags(flags);

  if (pf.dryRun) {
    await dryRunPrune(dir, rexDir, doc.items, pf);
    return;
  }

  // Preview what will be pruned before executing
  const prunable = findPrunableItems(doc.items);

  if (prunable.length === 0) {
    result("Nothing to prune.");
    if (!pf.skipConsolidate && doc.items.length > 0) {
      await consolidateAfterPrune(dir, rexDir, store, doc, pf);
    }
    return;
  }

  const preview = formatPrunePreview(prunable);

  // Interactive confirmation: show preview and ask before mutating
  // Skip confirmation for: JSON format, --yes flag, non-TTY, --accept flag
  const needsConfirmation = !pf.isJson && !pf.autoConfirm && !pf.accept && process.stdin.isTTY;

  if (needsConfirmation) {
    info("Pruning preview:\n");
    for (const line of preview.lines) {
      info(line);
    }
    info("");
    info(`Will remove ${preview.totalItems} completed item${preview.totalItems === 1 ? "" : "s"} (${formatLevelSummary(preview.byLevel)}).`);
    info("Items will be archived to archive.json for recovery.\n");

    const confirmed = await confirmPrompt("Proceed with prune? (y/n) ");
    if (!confirmed) {
      result("Prune cancelled.");
      return;
    }
    info("");
  }

  // Execute the prune
  const pruneResult = await executePrune(rexDir, store, doc, pf);

  if (!pruneResult) {
    result("Nothing to prune.");
    if (!pf.skipConsolidate && doc.items.length > 0) {
      await consolidateAfterPrune(dir, rexDir, store, doc, pf);
    }
    return;
  }

  // Output results
  if (pf.isJson) {
    const jsonResult: Record<string, unknown> = {
      pruned: pruneResult.pruned.map(summarize),
      prunedCount: pruneResult.prunedCount,
      archivePath: join(rexDir, ARCHIVE_FILE),
    };

    // Run consolidation and include in JSON output
    if (!pf.skipConsolidate && doc.items.length > 0) {
      const consolidation = await consolidateAfterPrune(dir, rexDir, store, doc, pf);
      if (consolidation) {
        jsonResult.consolidation = consolidation;
      }
    }

    result(JSON.stringify(jsonResult, null, 2));
  } else {
    result(`Pruned ${pruneResult.prunedCount} completed item${pruneResult.prunedCount === 1 ? "" : "s"}:`);
    for (const item of pruneResult.pruned) {
      result(`  ${icon(item.level)} ${item.title}`);
    }
    info(`Archived to ${ARCHIVE_FILE}`);

    // Chain consolidation after prune
    if (!pf.skipConsolidate && doc.items.length > 0) {
      await consolidateAfterPrune(dir, rexDir, store, doc, pf);
    }
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
  const pf = parseFlags(flags);

  if (doc.items.length === 0) {
    throw new CLIError(
      "PRD is empty — nothing to prune.",
      "Run 'rex analyze' first to build your PRD.",
    );
  }

  await initLLMConfig(rexDir);
  const { reasonForReshape, formatReshapeProposal } = await import("../../analyze/reshape-reason.js");

  info("Analyzing PRD for pruning opportunities...");
  const { proposals, tokenUsage } = await reasonForReshape(doc.items, {
    dir,
    model: pf.model,
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

  if (pf.dryRun) {
    if (pf.isJson) {
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
  if (pf.accept) {
    accepted = proposals;
  } else if (process.stdin.isTTY) {
    accepted = await interactiveAcceptProposals(proposals, doc.items, "Prune");
  } else {
    info("Run with --accept to apply, or use interactively in a TTY.");
    return;
  }

  if (accepted.length === 0) {
    result("No prune candidates accepted.");
    return;
  }

  // Apply via shared reshape helper
  info("Applying smart prune...");
  const reshapeResult = await applyAndPersistReshape(rexDir, store, doc, accepted, {
    archiveReason: "Smart prune: LLM-identified obsolete/mergeable items",
    logEvent: "smart_prune",
  });

  if (pf.isJson) {
    result(JSON.stringify({
      applied: reshapeResult.applied,
      archivedCount: reshapeResult.archivedCount,
    }, null, 2));
  } else {
    result(`Smart-pruned ${reshapeResult.applied} item${reshapeResult.applied === 1 ? "" : "s"}.`);
    if (reshapeResult.archivedCount > 0) {
      info(`  ${reshapeResult.archivedCount} item${reshapeResult.archivedCount === 1 ? "" : "s"} archived.`);
    }
  }
}
