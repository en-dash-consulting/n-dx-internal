/**
 * CLI command: rex parallel plan
 *
 * Loads the PRD, computes blast radii and conflict analysis,
 * and outputs a human-readable or JSON execution plan.
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { resolveStore } from "../../store/index.js";
import { computeExecutionPlan, formatExecutionPlan } from "../../parallel/execution-plan.js";
import type { ZoneIndex, ImportGraph } from "../../parallel/blast-radius.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { result, info } from "../output.js";

// ── Sourcevision data loading ────────────────────────────────────────────────
// These functions load sourcevision data from disk using the lightweight types
// declared in blast-radius.ts, preserving domain isolation (rex ⊥ sourcevision).

const SV_DIR = ".sourcevision";

/**
 * Load zone index from sourcevision analysis output.
 * Returns an empty map if sourcevision data is not available.
 */
function loadZones(dir: string): ZoneIndex {
  const zones: ZoneIndex = new Map();

  // Try zones.json first (sourcevision analysis output)
  const zonesPath = join(dir, SV_DIR, "zones.json");
  if (!existsSync(zonesPath)) return zones;

  try {
    const raw = JSON.parse(readFileSync(zonesPath, "utf-8"));
    // zones.json format: array of { id, files: string[] }
    if (Array.isArray(raw)) {
      for (const zone of raw) {
        if (zone.id && Array.isArray(zone.files)) {
          zones.set(zone.id, new Set(zone.files));
        }
      }
    }
  } catch {
    // Non-fatal — continue with empty zones
  }

  return zones;
}

/**
 * Load import graph from sourcevision analysis output.
 * Returns an empty map if sourcevision data is not available.
 */
function loadImports(dir: string): ImportGraph {
  const imports: ImportGraph = new Map();

  const importsPath = join(dir, SV_DIR, "imports.json");
  if (!existsSync(importsPath)) return imports;

  try {
    const raw = JSON.parse(readFileSync(importsPath, "utf-8"));
    // imports.json format: array of { source, target } edges
    if (Array.isArray(raw)) {
      for (const edge of raw) {
        if (edge.source && edge.target) {
          // Bidirectional: add both directions
          if (!imports.has(edge.source)) imports.set(edge.source, new Set());
          imports.get(edge.source)!.add(edge.target);
          if (!imports.has(edge.target)) imports.set(edge.target, new Set());
          imports.get(edge.target)!.add(edge.source);
        }
      }
    }
  } catch {
    // Non-fatal — continue with empty graph
  }

  return imports;
}

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
