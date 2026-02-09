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
  updateCandidateCount: number;
}

/** An existing item that could be updated with richer info from a scan result. */
export interface UpdateCandidate {
  itemId: string;
  itemTitle: string;
  field: string;
  current: string;
  proposed: string;
}

export interface ReconcileOptions {
  /** When true, generate update candidates for matched items with richer info. */
  detectUpdates?: boolean;
}

/**
 * Compare a scan result against its matched PRD item and produce update
 * candidates for fields where the scan result has richer content.
 */
function detectUpdateCandidates(
  proposal: ScanResult,
  matchedItem: PRDItem,
): UpdateCandidate[] {
  const candidates: UpdateCandidate[] = [];

  // Check description: propose update if scan result has one and existing is empty/shorter
  if (proposal.description) {
    const current = matchedItem.description ?? "";
    if (!current || (proposal.description.length > current.length * 1.3)) {
      candidates.push({
        itemId: matchedItem.id,
        itemTitle: matchedItem.title,
        field: "description",
        current: current || "(empty)",
        proposed: proposal.description,
      });
    }
  }

  // Check acceptance criteria: propose update if scan result has more criteria
  if (proposal.acceptanceCriteria && proposal.acceptanceCriteria.length > 0) {
    const currentCriteria = matchedItem.acceptanceCriteria ?? [];
    if (proposal.acceptanceCriteria.length > currentCriteria.length) {
      candidates.push({
        itemId: matchedItem.id,
        itemTitle: matchedItem.title,
        field: "acceptanceCriteria",
        current: currentCriteria.length > 0 ? currentCriteria.join("; ") : "(empty)",
        proposed: proposal.acceptanceCriteria.join("; "),
      });
    }
  }

  return candidates;
}

export function reconcile(
  proposals: ScanResult[],
  existing: PRDItem[],
  options: ReconcileOptions = {},
): { results: ScanResult[]; stats: ReconcileStats; updateCandidates: UpdateCandidate[] } {
  // Build index of existing items with their titles
  const existingEntries: Array<{ title: string; item: PRDItem }> = [];
  for (const { item } of walkTree(existing)) {
    existingEntries.push({ title: item.title, item });
  }

  const kept: ScanResult[] = [];
  const updateCandidates: UpdateCandidate[] = [];
  let alreadyTracked = 0;

  for (const proposal of proposals) {
    const match = existingEntries.find((e) =>
      fuzzyMatch(proposal.name, e.title),
    );

    if (match) {
      alreadyTracked++;

      // When detectUpdates is enabled, check if the scan result has richer info
      if (options.detectUpdates) {
        const candidates = detectUpdateCandidates(proposal, match.item);
        updateCandidates.push(...candidates);
      }
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
      updateCandidateCount: updateCandidates.length,
    },
    updateCandidates,
  };
}
