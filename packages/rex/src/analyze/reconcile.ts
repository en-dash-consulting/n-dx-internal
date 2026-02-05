import type { PRDItem } from "../schema/index.js";
import { walkTree } from "../core/tree.js";
import type { ScanResult } from "./scanners.js";
import { similarity } from "./dedupe.js";

/** Similarity threshold for considering a proposal already tracked in the PRD */
const RECONCILE_THRESHOLD = 0.7;

/**
 * Check whether a proposal name matches an existing PRD item title.
 * Uses the same multi-signal similarity function as deduplication to
 * catch near-duplicates (action verb synonyms, prefix matching, etc.)
 * in addition to exact and substring matches.
 */
function fuzzyMatch(proposal: string, existing: string): boolean {
  return similarity(proposal, existing) >= RECONCILE_THRESHOLD;
}

export interface ReconcileStats {
  total: number;
  alreadyTracked: number;
  newCount: number;
}

export function reconcile(
  proposals: ScanResult[],
  existing: PRDItem[],
): { results: ScanResult[]; stats: ReconcileStats } {
  const existingTitles: string[] = [];
  for (const { item } of walkTree(existing)) {
    existingTitles.push(item.title);
  }

  const kept: ScanResult[] = [];
  let alreadyTracked = 0;

  for (const proposal of proposals) {
    const isTracked = existingTitles.some((title) =>
      fuzzyMatch(proposal.name, title),
    );
    if (isTracked) {
      alreadyTracked++;
    } else {
      kept.push(proposal);
    }
  }

  return {
    results: kept,
    stats: {
      total: proposals.length,
      alreadyTracked,
      newCount: kept.length,
    },
  };
}
