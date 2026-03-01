import { join } from "node:path";
import { resolveStore } from "../../store/index.js";
import {
  detectReorganizations,
  formatReorganizationPlan,
} from "../../core/reorganize.js";
import type { ReorganizationProposal } from "../../core/reorganize.js";
import {
  applyProposals,
  formatApplyResult,
} from "../../core/reorganize-executor.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";

/**
 * `rex reorganize [options] [dir]`
 *
 * Detect structural issues in the PRD and propose reorganizations.
 * - Default: detect + display proposals
 * - `--accept`: apply all low-risk proposals
 * - `--accept=1,3`: apply specific proposals by ID
 * - `--dry-run`: same as default (detect only)
 * - `--include-completed`: include completed items in analysis
 */
export async function cmdReorganize(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  if (doc.items.length === 0) {
    throw new CLIError(
      "PRD is empty — nothing to reorganize.",
      "Run 'rex analyze' first to build your PRD.",
    );
  }

  const includeCompleted = flags["include-completed"] === "true";

  // Detect proposals
  info("Analyzing PRD structure...");
  const plan = detectReorganizations(doc.items, { includeCompleted });

  if (plan.proposals.length === 0) {
    if (flags.format === "json") {
      result(JSON.stringify({ proposals: [], stats: plan.stats }, null, 2));
    } else {
      result("No reorganization proposals — PRD structure looks good.");
    }
    return;
  }

  // Display proposals
  if (flags.format !== "json") {
    result(formatReorganizationPlan(plan));
  }

  // Determine which proposals to apply
  const acceptFlag = flags.accept;
  if (acceptFlag === undefined) {
    // Detection only — show proposals and exit
    if (flags.format === "json") {
      result(JSON.stringify({
        proposals: plan.proposals.map(summarizeProposal),
        stats: plan.stats,
      }, null, 2));
    } else {
      info("\nRun with --accept to apply all low-risk proposals, or --accept=1,3 to pick specific ones.");
    }
    return;
  }

  // Parse accept flag: --accept (all low-risk) or --accept=1,3 (specific IDs)
  let toApply: ReorganizationProposal[];
  if (acceptFlag === "true") {
    // --accept with no value: apply low-risk proposals only
    toApply = plan.proposals.filter((p) => p.risk === "low");
    if (toApply.length === 0) {
      info("No low-risk proposals to apply. Use --accept=<ids> to apply specific proposals.");
      return;
    }
    if (toApply.length < plan.proposals.length) {
      info(`\nApplying ${toApply.length} low-risk proposal${toApply.length === 1 ? "" : "s"} (skipping ${plan.proposals.length - toApply.length} higher-risk).`);
    }
  } else {
    // --accept=1,3 — parse comma-separated IDs
    const ids = acceptFlag.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    if (ids.length === 0) {
      throw new CLIError(
        "Invalid --accept value.",
        "Usage: --accept (all low-risk) or --accept=1,3 (specific proposal IDs)",
      );
    }
    const idSet = new Set(ids);
    toApply = plan.proposals.filter((p) => idSet.has(p.id));
    const missing = ids.filter((id) => !plan.proposals.some((p) => p.id === id));
    if (missing.length > 0) {
      info(`Warning: proposal IDs not found: ${missing.join(", ")}`);
    }
    if (toApply.length === 0) {
      info("No matching proposals to apply.");
      return;
    }
  }

  // Apply proposals
  info(`\nApplying ${toApply.length} proposal${toApply.length === 1 ? "" : "s"}...`);
  const applyResult = applyProposals(doc.items, toApply);

  // Save document
  if (applyResult.applied > 0) {
    await store.saveDocument(doc);
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "reorganize_applied",
      detail: `Applied ${applyResult.applied} reorganization proposals`,
    });
  }

  // Output results
  if (flags.format === "json") {
    result(JSON.stringify({
      ...applyResult,
      stats: plan.stats,
    }, null, 2));
  } else {
    result(formatApplyResult(applyResult));
  }
}

function summarizeProposal(p: ReorganizationProposal): Record<string, unknown> {
  return {
    id: p.id,
    type: p.type,
    description: p.description,
    risk: p.risk,
    confidence: p.confidence,
    items: p.items,
  };
}
