import type { ScanResult } from "./scanners.js";
import { deduplicateScanResults } from "./dedupe.js";

export interface ProposalTask {
  title: string;
  source: string;
  sourceFile: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: string;
  tags?: string[];
}

export interface ProposalFeature {
  title: string;
  source: string;
  description?: string;
  tasks: ProposalTask[];
}

export interface Proposal {
  epic: { title: string; source: string; description?: string };
  features: ProposalFeature[];
}

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function inferEpic(result: ScanResult): string {
  // Use first tag as epic grouping (scanners set this to directory-inferred epic)
  if (result.tags && result.tags.length > 0) {
    return result.tags[0];
  }
  // Fall back to source type
  return result.source === "sourcevision"
    ? "SourceVision"
    : result.source === "test"
      ? "Tests"
      : result.source === "package"
        ? "Package"
        : "Documentation";
}

/**
 * Derive a descriptive title from a file path by taking the basename,
 * stripping extensions, and converting to title case.
 */
function titleFromPath(filePath: string): string {
  // Extract the file name: strip directories
  const parts = filePath.split("/");
  const base = parts[parts.length - 1] || filePath;
  // Strip extensions (including .test.ts, .spec.tsx, etc.)
  const name = base
    .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "")
    .replace(/\.(ts|tsx|js|jsx|json|md|txt|yaml|yml)$/, "");
  // Convert kebab-case, snake_case, dots to spaces and title-case
  return name
    .replace(/[-_.]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Compute tag overlap between two tag arrays. Returns the number of shared
 * tags (case-insensitive), excluding the first tag (which is used for epic
 * grouping).
 */
function tagOverlap(tagsA?: string[], tagsB?: string[]): number {
  if (!tagsA || !tagsB || tagsA.length < 2 || tagsB.length < 2) return 0;
  // Compare all tags (including first) for matching purposes
  const setB = new Set(tagsB.map(normalize));
  let count = 0;
  for (const tag of tagsA) {
    if (setB.has(normalize(tag))) count++;
  }
  return count;
}

interface EpicEntry {
  source: string;
  description?: string;
  features: Map<string, { result: ScanResult; tasks: ScanResult[] }>;
}

export function buildProposals(results: ScanResult[]): Proposal[] {
  // Deduplicate within proposal set: merge near-duplicates by kind
  const deduped = deduplicateScanResults(results);

  // Separate by kind
  const epics = deduped.filter((r) => r.kind === "epic");
  const features = deduped.filter((r) => r.kind === "feature");
  const tasks = deduped.filter((r) => r.kind === "task");

  // Group features and tasks by epic
  const epicMap = new Map<string, EpicEntry>();

  // Seed from explicit epics (preserve description)
  for (const e of epics) {
    const key = normalize(e.name);
    if (!epicMap.has(key)) {
      epicMap.set(key, {
        source: e.source,
        description: e.description,
        features: new Map(),
      });
    }
  }

  // Place features under epics
  for (const f of features) {
    const epicName = normalize(inferEpic(f));
    if (!epicMap.has(epicName)) {
      epicMap.set(epicName, { source: f.source, features: new Map() });
    }
    const epic = epicMap.get(epicName)!;
    const fKey = normalize(f.name);
    if (!epic.features.has(fKey)) {
      epic.features.set(fKey, { result: f, tasks: [] });
    }
  }

  // Place tasks under features using multi-strategy matching:
  // 1. Exact sourceFile match (strongest signal)
  // 2. Tag overlap match (semantic grouping)
  // 3. Create implicit feature (fallback)
  for (const t of tasks) {
    const epicName = normalize(inferEpic(t));
    if (!epicMap.has(epicName)) {
      epicMap.set(epicName, { source: t.source, features: new Map() });
    }
    const epic = epicMap.get(epicName)!;

    // Strategy 1: exact sourceFile match
    let placed = false;
    for (const [, feat] of epic.features) {
      if (feat.result.sourceFile === t.sourceFile) {
        feat.tasks.push(t);
        placed = true;
        break;
      }
    }

    // Strategy 2: tag overlap — find the feature with the most shared tags
    if (!placed && t.tags && t.tags.length > 0) {
      let bestFeat: { result: ScanResult; tasks: ScanResult[] } | null = null;
      let bestOverlap = 0;

      for (const [, feat] of epic.features) {
        const overlap = tagOverlap(t.tags, feat.result.tags);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestFeat = feat;
        }
      }

      if (bestFeat && bestOverlap >= 1) {
        bestFeat.tasks.push(t);
        placed = true;
      }
    }

    if (!placed) {
      // Create an implicit feature with a descriptive title from the file path
      const implicitKey = normalize(t.sourceFile || t.name);
      if (!epic.features.has(implicitKey)) {
        const implicitTitle = t.sourceFile
          ? titleFromPath(t.sourceFile)
          : t.name;
        epic.features.set(implicitKey, {
          result: {
            name: implicitTitle,
            source: t.source,
            sourceFile: t.sourceFile,
            kind: "feature",
          },
          tasks: [],
        });
      }
      epic.features.get(implicitKey)!.tasks.push(t);
    }
  }

  // Build final proposals
  const proposals: Proposal[] = [];
  for (const [epicKey, epicData] of epicMap) {
    // Skip empty epics that have no features
    if (epicData.features.size === 0) continue;

    const featureList: ProposalFeature[] = [];
    for (const [, feat] of epicData.features) {
      // Sort tasks by priority
      const sortedTasks = feat.tasks.sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority ?? "medium"] ?? 2) -
          (PRIORITY_ORDER[b.priority ?? "medium"] ?? 2),
      );

      featureList.push({
        title: feat.result.name,
        source: feat.result.source,
        description: feat.result.description,
        tasks: sortedTasks.map((t) => ({
          title: t.name,
          source: t.source,
          sourceFile: t.sourceFile,
          description: t.description,
          acceptanceCriteria: t.acceptanceCriteria,
          priority: t.priority,
          tags: t.tags,
        })),
      });
    }

    // Sort features: those with higher-priority tasks first
    featureList.sort((a, b) => {
      const aPri = Math.min(
        ...a.tasks.map((t) => PRIORITY_ORDER[t.priority ?? "medium"] ?? 2),
        2,
      );
      const bPri = Math.min(
        ...b.tasks.map((t) => PRIORITY_ORDER[t.priority ?? "medium"] ?? 2),
        2,
      );
      return aPri - bPri;
    });

    // Use original casing for epic title from the first entry
    const epicTitle =
      epics.find((e) => normalize(e.name) === epicKey)?.name ??
      features.find((f) => normalize(inferEpic(f)) === epicKey)?.tags?.[0] ??
      tasks.find((t) => normalize(inferEpic(t)) === epicKey)?.tags?.[0] ??
      epicKey;

    proposals.push({
      epic: {
        title: epicTitle,
        source: epicData.source,
        description: epicData.description,
      },
      features: featureList,
    });
  }

  // Sort proposals: those with higher-priority content first
  proposals.sort((a, b) => {
    const aPri = Math.min(
      ...a.features.flatMap((f) =>
        f.tasks.map((t) => PRIORITY_ORDER[t.priority ?? "medium"] ?? 2),
      ),
      2,
    );
    const bPri = Math.min(
      ...b.features.flatMap((f) =>
        f.tasks.map((t) => PRIORITY_ORDER[t.priority ?? "medium"] ?? 2),
      ),
      2,
    );
    return aPri - bPri;
  });

  return proposals;
}
