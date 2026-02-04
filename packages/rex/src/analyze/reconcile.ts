import type { PRDItem } from "../schema/index.js";
import { walkTree } from "../core/tree.js";
import type { ScanResult } from "./scanners.js";

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function fuzzyMatch(proposal: string, existing: string): boolean {
  const a = normalize(proposal);
  const b = normalize(existing);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
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
