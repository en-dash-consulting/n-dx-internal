import type { PRDDocument } from "../../schema/index.js";
import type { EpiclessFeature } from "../../core/structural.js";
import { insertChild, removeFromTree } from "../../core/tree.js";
import { info, warn } from "../output.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type EpiclessAction = "correlate" | "delete" | "skip";

export interface EpiclessResolution {
  featureId: string;
  action: EpiclessAction;
  /** Target epic ID when action is "correlate". */
  targetEpicId?: string;
}

/**
 * Function signature for interactive prompts.
 * Abstracted for testability — production uses readline, tests inject stubs.
 */
export type PromptFn = (question: string) => Promise<string>;

// ── Interactive resolution ───────────────────────────────────────────────────

/**
 * Present interactive prompts to resolve epicless features found during validation.
 *
 * For each epicless feature, the user can:
 * - **Correlate**: move it under an existing epic
 * - **Delete**: remove the feature (and its children) from the PRD
 * - **Skip**: leave it unchanged (still reported as validation error)
 *
 * Returns an array of resolutions describing the chosen action per feature.
 *
 * @param doc              The loaded PRD document (read-only for resolution gathering)
 * @param epiclessFeatures Detected epicless features from structural validation
 * @param options.prompt   Injectable prompt function (default: readline-based TTY prompt)
 */
export async function resolveEpiclessFeatures(
  doc: PRDDocument,
  epiclessFeatures: EpiclessFeature[],
  options?: { prompt?: PromptFn },
): Promise<EpiclessResolution[]> {
  const prompt = options?.prompt ?? defaultPrompt;
  const resolutions: EpiclessResolution[] = [];

  // Collect available epics for correlation
  const availableEpics = doc.items.filter(
    (item) => item.level === "epic" && item.status !== "deleted",
  );

  info("");
  info(
    `Found ${epiclessFeatures.length} feature${epiclessFeatures.length === 1 ? "" : "s"} without parent epic${epiclessFeatures.length === 1 ? "" : "s"}:`,
  );

  for (const feature of epiclessFeatures) {
    const childInfo =
      feature.childCount > 0
        ? `, ${feature.childCount} child${feature.childCount === 1 ? "" : "ren"}`
        : "";

    info("");
    info(
      `  Feature: "${feature.title}" [${feature.itemId.slice(0, 8)}] (${feature.status}${childInfo})`,
    );
    info("    [1] Correlate — move under an existing epic");
    info("    [2] Delete — remove this feature and its children");
    info("    [3] Skip — leave as-is");

    const choice = await prompt("  Choice (1-3): ");

    switch (choice.trim()) {
      case "1": {
        if (availableEpics.length === 0) {
          warn("  No epics available for correlation. Skipping.");
          resolutions.push({ featureId: feature.itemId, action: "skip" });
          break;
        }

        info("");
        info("  Available epics:");
        for (let i = 0; i < availableEpics.length; i++) {
          info(
            `    [${i + 1}] "${availableEpics[i].title}" [${availableEpics[i].id.slice(0, 8)}]`,
          );
        }

        const epicChoice = await prompt(
          `  Move under which epic? (1-${availableEpics.length}): `,
        );
        const epicIdx = parseInt(epicChoice.trim(), 10) - 1;

        if (epicIdx >= 0 && epicIdx < availableEpics.length) {
          resolutions.push({
            featureId: feature.itemId,
            action: "correlate",
            targetEpicId: availableEpics[epicIdx].id,
          });
          info(`  \u2713 Will move under "${availableEpics[epicIdx].title}"`);
        } else {
          warn("  Invalid epic selection. Skipping.");
          resolutions.push({ featureId: feature.itemId, action: "skip" });
        }
        break;
      }

      case "2":
        resolutions.push({ featureId: feature.itemId, action: "delete" });
        info("  \u2713 Marked for deletion");
        break;

      case "3":
        resolutions.push({ featureId: feature.itemId, action: "skip" });
        info("  \u2192 Skipped");
        break;

      default:
        warn("  Invalid choice. Skipping.");
        resolutions.push({ featureId: feature.itemId, action: "skip" });
        break;
    }
  }

  return resolutions;
}

// ── Apply resolutions ────────────────────────────────────────────────────────

/**
 * Apply epicless feature resolutions to the PRD document.
 *
 * Mutates `doc.items` in place:
 * - **correlate**: removes the feature from root and inserts it under the target epic
 * - **delete**: removes the feature (and children) from the tree entirely
 * - **skip**: no mutation
 *
 * @returns The number of mutations applied.
 */
export function applyEpiclessResolutions(
  doc: PRDDocument,
  resolutions: EpiclessResolution[],
): number {
  let mutated = 0;

  for (const resolution of resolutions) {
    if (resolution.action === "skip") continue;

    if (resolution.action === "correlate" && resolution.targetEpicId) {
      const feature = removeFromTree(doc.items, resolution.featureId);
      if (feature) {
        const inserted = insertChild(
          doc.items,
          resolution.targetEpicId,
          feature,
        );
        if (inserted) {
          mutated++;
        } else {
          // Insertion failed (shouldn't happen with valid epic target) — restore
          doc.items.push(feature);
        }
      }
    }

    if (resolution.action === "delete") {
      const removed = removeFromTree(doc.items, resolution.featureId);
      if (removed) {
        mutated++;
      }
    }
  }

  return mutated;
}

// ── Default readline prompt ──────────────────────────────────────────────────

async function defaultPrompt(question: string): Promise<string> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) =>
    rl.question(question, resolve),
  );
  rl.close();
  return answer;
}
