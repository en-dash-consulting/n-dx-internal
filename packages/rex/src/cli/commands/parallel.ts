/**
 * CLI command: rex parallel {plan|reconcile}
 *
 * - `plan`: Loads the PRD, computes blast radii and conflict analysis,
 *   and outputs a human-readable or JSON execution plan.
 * - `reconcile <dir>`: Merges worktree task completions back to main PRD.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import { resolveStore } from "../../store/index.js";
import { computeExecutionPlan, formatExecutionPlan } from "../../parallel/execution-plan.js";
import { reconcile } from "../../parallel/reconcile.js";
import { loadZones, loadImports } from "../../parallel/sourcevision-loader.js";
import { REX_DIR } from "./constants.js";
import { CLIError, requireRexDir } from "../errors.js";
import { result, info } from "../output.js";
import type { PRDDocument } from "../../schema/index.js";

// ── Command handler ──────────────────────────────────────────────────────────

/**
 * Dispatch the `rex parallel` subcommand.
 * Supported: "plan", "reconcile".
 */
export async function cmdParallel(
  dir: string,
  subcommand: string | undefined,
  flags: Record<string, string>,
  /** Extra positional args after the subcommand (used by reconcile for worktree dir). */
  positionalArgs: string[] = [],
): Promise<void> {
  if (!subcommand || subcommand === "plan") {
    await cmdParallelPlan(dir, flags);
    return;
  }

  if (subcommand === "reconcile") {
    await cmdParallelReconcile(dir, positionalArgs, flags);
    return;
  }

  throw new CLIError(
    `Unknown parallel subcommand: ${subcommand}`,
    "Available subcommands: plan, reconcile. Usage: rex parallel <plan|reconcile> [dir]",
  );
}

/**
 * Execute `rex parallel plan`.
 *
 * Loads the PRD and sourcevision data, computes the execution plan,
 * and outputs it in human-readable or JSON format.
 */
async function cmdParallelPlan(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  if (doc.items.length === 0) {
    if (flags.format === "json") {
      result(JSON.stringify({
        groups: [],
        serialTasks: [],
        conflicts: [],
        totalTasks: 0,
        maxParallelism: 0,
        taskMeta: {},
      }, null, 2));
    } else {
      result("No items in PRD. Run: rex add epic --title=\"...\" " + dir);
    }
    return;
  }

  // Load sourcevision data (non-fatal if unavailable)
  const zones = loadZones(dir);
  const imports = loadImports(dir);

  if (zones.size === 0 && imports.size === 0) {
    info("Note: No sourcevision data found. Run 'ndx analyze' for better conflict detection.");
  }

  // Compute the execution plan
  const plan = computeExecutionPlan(doc.items, zones, imports);

  if (flags.format === "json") {
    result(JSON.stringify(plan, null, 2));
    return;
  }

  result(formatExecutionPlan(plan));
}

// ── Reconcile ────────────────────────────────────────────────────────────────

/**
 * Execute `rex parallel reconcile <worktree-dir>`.
 *
 * Reads the worktree's `.rex/prd.json` and applies task status changes
 * (completed, failing) back to the main PRD. Structural changes are ignored.
 *
 * @param dir              - Main project directory (where .rex/ lives).
 * @param positionalArgs   - Remaining positional args; first is the worktree dir.
 * @param flags            - CLI flags (--format=json supported).
 */
async function cmdParallelReconcile(
  dir: string,
  positionalArgs: string[],
  flags: Record<string, string>,
): Promise<void> {
  // The worktree dir is the first positional arg
  const rawWorktreeDir = positionalArgs[0];
  if (!rawWorktreeDir) {
    throw new CLIError(
      "Missing worktree directory.",
      "Usage: rex parallel reconcile <worktree-dir> [main-dir]",
    );
  }

  const worktreeDir = isAbsolute(rawWorktreeDir)
    ? rawWorktreeDir
    : resolve(rawWorktreeDir);

  // Validate main project dir
  requireRexDir(dir);

  // Validate worktree dir has .rex/prd.json
  const worktreePrdPath = join(worktreeDir, REX_DIR, "prd.json");
  if (!existsSync(worktreePrdPath)) {
    throw new CLIError(
      `Worktree PRD not found at ${worktreePrdPath}`,
      "Ensure the worktree directory contains a .rex/prd.json file.",
    );
  }

  // Load worktree PRD document from disk (read-only, no store needed)
  const worktreeRaw = await readFile(worktreePrdPath, "utf-8");
  let worktreeDoc: PRDDocument;
  try {
    worktreeDoc = JSON.parse(worktreeRaw) as PRDDocument;
  } catch {
    throw new CLIError(
      "Failed to parse worktree prd.json.",
      `Check ${worktreePrdPath} for syntax errors.`,
    );
  }

  // Open the main store
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  // Run reconciliation
  const summary = await reconcile(store, worktreeDoc);

  // Output results
  if (flags.format === "json") {
    result(JSON.stringify({
      reconciled: summary.reconciled.length,
      skipped: summary.skipped,
      conflicts: summary.conflicts.length,
      totalExamined: summary.totalExamined,
      changes: summary.reconciled,
      conflictDetails: summary.conflicts,
    }, null, 2));
    return;
  }

  // Human-readable output
  if (summary.reconciled.length > 0) {
    result(`Reconciled ${summary.reconciled.length} item(s):`);
    for (const change of summary.reconciled) {
      info(`  ${change.level} "${change.title}": ${change.mainStatus} → ${change.worktreeStatus}`);
    }
  }

  if (summary.conflicts.length > 0) {
    result(`\nConflicts (${summary.conflicts.length}):`);
    for (const conflict of summary.conflicts) {
      info(`  ${conflict.level} "${conflict.title}": ${conflict.mainStatus} → ${conflict.worktreeStatus}`);
      info(`    Reason: ${conflict.reason}`);
    }
  }

  result(`\nSummary: ${summary.reconciled.length} reconciled, ${summary.skipped} skipped, ${summary.conflicts.length} conflicts`);
}
