import { join } from "node:path";
import { resolveStore } from "../../store/index.js";
import {
  aggregateTokenUsage,
  formatAggregateTokenUsage,
  estimateCost,
} from "../../core/token-usage.js";
import { CLIError } from "../errors.js";
import { REX_DIR } from "./constants.js";
import { info, result } from "../output.js";
import type { AggregateTokenUsage, TokenUsageFilter } from "../../core/token-usage.js";

const VALID_FORMATS = ["json", "tree"] as const;

/** Format a number with locale-aware commas. */
function fmt(n: number): string {
  return n.toLocaleString();
}

/**
 * Format detailed per-package breakdown for tree output.
 * Shows input/output split and call count for each package with usage.
 */
function formatPackageDetail(usage: AggregateTokenUsage): string[] {
  const lines: string[] = [];
  const entries: Array<{ name: string; pkg: typeof usage.packages.rex; unit: string }> = [
    { name: "rex", pkg: usage.packages.rex, unit: "calls" },
    { name: "hench", pkg: usage.packages.hench, unit: "runs" },
    { name: "sv", pkg: usage.packages.sv, unit: "calls" },
  ];

  for (const { name, pkg, unit } of entries) {
    const total = pkg.inputTokens + pkg.outputTokens;
    if (total === 0) continue;
    lines.push(
      `  ${name}: ${fmt(total)} tokens (${fmt(pkg.inputTokens)} in / ${fmt(pkg.outputTokens)} out) — ${pkg.calls} ${unit}`,
    );
  }

  return lines;
}

export async function cmdUsage(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const format = flags.format;

  if (format && !VALID_FORMATS.includes(format as (typeof VALID_FORMATS)[number])) {
    throw new CLIError(
      `Unknown format: "${format}"`,
      `Valid formats: ${VALID_FORMATS.join(", ")}`,
    );
  }

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  // Build time filter
  const tokenFilter: TokenUsageFilter = {};
  if (flags.since) tokenFilter.since = flags.since;
  if (flags.until) tokenFilter.until = flags.until;

  const logEntries = await store.readLog();
  const usage = await aggregateTokenUsage(logEntries, dir, tokenFilter);
  const cost = estimateCost(usage);

  if (format === "json") {
    const output: Record<string, unknown> = { ...usage };
    output.estimatedCost = {
      total: cost.total,
      inputCost: cost.inputCost,
      outputCost: cost.outputCost,
    };

    // Only include filter if filters were applied
    if (tokenFilter.since || tokenFilter.until) {
      const filter: Record<string, string> = {};
      if (tokenFilter.since) filter.since = tokenFilter.since;
      if (tokenFilter.until) filter.until = tokenFilter.until;
      output.filter = filter;
    }

    result(JSON.stringify(output, null, 2));
    return;
  }

  // Tree output
  for (const line of formatAggregateTokenUsage(usage)) {
    result(line);
  }

  // Detailed per-package breakdown (only when there is data)
  const total = usage.totalInputTokens + usage.totalOutputTokens;
  if (total > 0) {
    info("");
    info("By package:");
    for (const line of formatPackageDetail(usage)) {
      info(line);
    }

    // Cost estimation
    info("");
    info(`Estimated cost: ${cost.total} (based on Sonnet pricing)`);
  }

  // Filter notice
  if (tokenFilter.since || tokenFilter.until) {
    const parts: string[] = [];
    if (tokenFilter.since) parts.push(`since ${tokenFilter.since}`);
    if (tokenFilter.until) parts.push(`until ${tokenFilter.until}`);
    info(`  (filtered: ${parts.join(", ")})`);
  }
}
