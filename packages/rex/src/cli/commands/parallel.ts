/**
 * CLI command: rex parallel plan
 *
 * Loads the PRD, computes blast radii and conflict analysis,
 * and outputs a human-readable or JSON execution plan.
 */

import { join } from "node:path";
import { resolveStore } from "../../store/index.js";
import { computeExecutionPlan, formatExecutionPlan } from "../../parallel/execution-plan.js";
import { loadZones, loadImports } from "../../parallel/sourcevision-loader.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { result, info } from "../output.js";

// ── Command handler ──────────────────────────────────────────────────────────

/**
 * Dispatch the `rex parallel` subcommand.
 * Currently only "plan" is supported.
 */
export async function cmdParallel(
  dir: string,
  subcommand: string | undefined,
  flags: Record<string, string>,
): Promise<void> {
  if (!subcommand || subcommand === "plan") {
    await cmdParallelPlan(dir, flags);
    return;
  }

  throw new CLIError(
    `Unknown parallel subcommand: ${subcommand}`,
    "Available subcommands: plan. Usage: rex parallel plan [dir]",
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
