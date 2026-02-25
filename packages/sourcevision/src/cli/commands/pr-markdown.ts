/**
 * PR markdown generation command.
 *
 * Generates PR-ready markdown from rex completion data and branch
 * work records, without relying on git diff output.
 *
 * ## Flow
 *
 * 1. Collect completed work items from the rex PRD via the branch work collector.
 * 2. Convert the result to a {@link BranchWorkRecord}.
 * 3. Render markdown using the pure-function template generator.
 * 4. Write to `.sourcevision/pr-markdown.md`.
 *
 * Works without git history — the collector degrades gracefully
 * when git is unavailable, returning all completed items as branch work.
 *
 * @module sourcevision/cli/commands/pr-markdown
 */

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { requireSvDir } from "../errors.js";
import { SV_DIR } from "./constants.js";
import { info } from "../output.js";
import { collectBranchWork } from "../../analyzers/branch-work-collector.js";
import { renderPRMarkdownFromRecord } from "../../generators/pr-markdown-template.js";
import type {
  BranchWorkRecord,
  BranchWorkRecordItem,
  BranchWorkEpicSummary,
} from "../../schema/v1.js";
import type { BranchWorkResult } from "../../analyzers/branch-work-collector.js";

const OUTPUT_FILENAME = "pr-markdown.md";

/**
 * Convert a {@link BranchWorkResult} from the collector into a
 * {@link BranchWorkRecord} suitable for the PR markdown template renderer.
 *
 * Items without a `completedAt` timestamp use the collection timestamp
 * as a fallback — these are items that were marked completed in the PRD
 * but lack explicit timestamps.
 */
export function toBranchWorkRecord(result: BranchWorkResult): BranchWorkRecord {
  const now = result.collectedAt;

  const items: BranchWorkRecordItem[] = result.items.map((item) => ({
    id: item.id,
    title: item.title,
    level: item.level,
    completedAt: item.completedAt ?? now,
    parentChain: item.parentChain.map((ref) => ({
      id: ref.id,
      title: ref.title,
      level: ref.level,
    })),
    ...(item.priority !== undefined && { priority: item.priority }),
    ...(item.tags !== undefined && { tags: item.tags }),
    ...(item.description !== undefined && { description: item.description }),
    ...(item.acceptanceCriteria !== undefined && {
      acceptanceCriteria: item.acceptanceCriteria,
    }),
  }));

  const epicSummaries: BranchWorkEpicSummary[] = (
    result.epicSummaries ?? []
  ).map((s) => ({
    id: s.id,
    title: s.title,
    completedCount: s.completedCount,
  }));

  return {
    schemaVersion: "1.0.0",
    branch: result.branch,
    baseBranch: result.baseBranch,
    createdAt: now,
    updatedAt: now,
    items,
    epicSummaries,
  };
}

/**
 * Generate PR markdown from rex completion data.
 *
 * Collects completed work items from `.rex/prd.json`, converts to a
 * branch work record, and renders structured markdown organized by
 * epics and features.
 *
 * Gracefully handles:
 * - Missing `.rex/prd.json` (produces "no completed work" output)
 * - Non-git directories (all completed items treated as branch work)
 * - Missing base branch (all completed items treated as branch work)
 * - Corrupted PRD JSON (produces empty result with warnings)
 */
export async function cmdPrMarkdown(targetDir: string): Promise<void> {
  const absDir = resolve(targetDir);
  requireSvDir(absDir);

  const result = await collectBranchWork({ dir: absDir });

  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      info(`Warning: ${err}`);
    }
  }

  const record = toBranchWorkRecord(result);
  const markdown = renderPRMarkdownFromRecord(record);
  const outputPath = join(absDir, SV_DIR, OUTPUT_FILENAME);
  writeFileSync(outputPath, markdown, "utf-8");
  info(`PR markdown regenerated → ${outputPath}`);
}
