/**
 * File classification engine.
 *
 * Classifies each source file against the archetype catalog by matching
 * weighted signals (path patterns, directory patterns, filename patterns,
 * export patterns) and accumulating evidence scores.
 *
 * The highest-scoring archetype above the confidence threshold becomes
 * the primary classification. Additional archetypes above a secondary
 * threshold are recorded as secondaryArchetypes.
 */

import { basename } from "node:path";
import type {
  Inventory,
  Imports,
  ImportEdge,
  ArchetypeDefinition,
  ArchetypeSignal,
  FileClassification,
  ClassificationEvidence,
  Classifications,
  ClassificationsSummary,
} from "../schema/index.js";
import { BUILTIN_ARCHETYPES } from "./archetypes.js";
import { sortClassifications } from "../util/sort.js";

/** Minimum accumulated score for a primary classification. */
const PRIMARY_THRESHOLD = 0.4;

/** Minimum accumulated score for a secondary classification. */
const SECONDARY_THRESHOLD = 0.3;

export interface ClassifyOptions {
  /** Previous classifications for incremental mode. */
  previousClassifications?: Classifications;
  /** Changed files (from inventory diff) — only reclassify these. */
  changedFiles?: Set<string>;
  /** Custom archetypes to merge with built-ins. */
  customArchetypes?: ArchetypeDefinition[];
  /** Per-file overrides: path → archetype ID. */
  overrides?: Record<string, string>;
}

/**
 * Classify all source files against the archetype catalog.
 */
export function analyzeClassifications(
  inventory: Inventory,
  imports: Imports,
  options?: ClassifyOptions,
): Classifications {
  const archetypes = mergeArchetypes(
    BUILTIN_ARCHETYPES,
    options?.customArchetypes,
  );

  // Build export map: file → exported symbol names
  const exportMap = buildExportMap(imports.edges);

  // Determine which files need reclassification
  const previousMap = new Map<string, FileClassification>();
  if (options?.previousClassifications) {
    for (const fc of options.previousClassifications.files) {
      previousMap.set(fc.path, fc);
    }
  }

  const sourceFiles = inventory.files.filter((f) => f.role === "source");
  const classifications: FileClassification[] = [];

  for (const file of sourceFiles) {
    // User override takes highest priority
    if (options?.overrides?.[file.path]) {
      const archetypeId = options.overrides[file.path];
      const valid = archetypes.some((a) => a.id === archetypeId);
      classifications.push({
        path: file.path,
        archetype: valid ? archetypeId : null,
        confidence: valid ? 1.0 : 0,
        source: "user-override",
      });
      continue;
    }

    // Incremental: reuse cached classification for unchanged files
    if (
      options?.changedFiles &&
      !options.changedFiles.has(file.path) &&
      previousMap.has(file.path)
    ) {
      const prev = previousMap.get(file.path)!;
      // Don't reuse user overrides that were removed
      if (prev.source !== "user-override" || options?.overrides?.[file.path]) {
        classifications.push(prev);
        continue;
      }
    }

    // Classify the file
    const result = classifyFile(
      file.path,
      archetypes,
      exportMap.get(file.path),
    );
    classifications.push(result);
  }

  const summary = computeSummary(classifications);

  return sortClassifications({
    archetypes,
    files: classifications,
    summary,
  });
}

/**
 * Classify a single file against all archetypes.
 */
function classifyFile(
  filePath: string,
  archetypes: ArchetypeDefinition[],
  exports?: string[],
): FileClassification {
  const fileName = basename(filePath);
  const evidence: ClassificationEvidence[] = [];

  // Accumulate scores per archetype
  const scores = new Map<string, number>();

  for (const archetype of archetypes) {
    let archetypeScore = 0;

    for (const signal of archetype.signals) {
      const match = matchSignal(signal, filePath, fileName, exports);
      if (match) {
        archetypeScore += signal.weight;
        evidence.push({
          archetypeId: archetype.id,
          signalKind: signal.kind,
          detail: match,
          weight: signal.weight,
        });
      }
    }

    if (archetypeScore > 0) {
      scores.set(archetype.id, archetypeScore);
    }
  }

  // Find primary archetype (highest score above threshold)
  let primaryId: string | null = null;
  let primaryScore = 0;
  for (const [id, score] of scores) {
    if (score > primaryScore) {
      primaryScore = score;
      primaryId = id;
    }
  }

  if (primaryScore < PRIMARY_THRESHOLD) {
    primaryId = null;
    primaryScore = 0;
  }

  // Find secondary archetypes (above secondary threshold, not primary)
  const secondaryArchetypes: string[] = [];
  for (const [id, score] of scores) {
    if (id !== primaryId && score >= SECONDARY_THRESHOLD) {
      secondaryArchetypes.push(id);
    }
  }
  secondaryArchetypes.sort();

  // Normalize confidence to 0-1 range (cap at 1.0)
  const confidence = Math.min(primaryScore, 1.0);

  return {
    path: filePath,
    archetype: primaryId,
    ...(secondaryArchetypes.length > 0 ? { secondaryArchetypes } : {}),
    confidence: Math.round(confidence * 100) / 100,
    source: "algorithmic" as const,
    ...(evidence.length > 0 ? { evidence } : {}),
  };
}

/**
 * Match a single signal against a file. Returns a description string if matched.
 */
function matchSignal(
  signal: ArchetypeSignal,
  filePath: string,
  fileName: string,
  exports?: string[],
): string | null {
  const re = new RegExp(signal.pattern);

  switch (signal.kind) {
    case "path":
      if (re.test(filePath)) return `path matches ${signal.pattern}`;
      return null;

    case "filename":
      if (re.test(fileName)) return `filename "${fileName}" matches ${signal.pattern}`;
      return null;

    case "directory":
      // Directory signals use string containment for simple patterns
      if (filePath.includes(signal.pattern)) return `path contains "${signal.pattern}"`;
      return null;

    case "export":
      if (!exports) return null;
      for (const sym of exports) {
        if (re.test(sym)) return `exports "${sym}" matching ${signal.pattern}`;
      }
      return null;

    case "import":
      // Import signal matching would require the full import graph
      // For now, handle via evidence from the import data
      return null;

    default:
      return null;
  }
}

/**
 * Build a map of file → exported symbol names from re-export edges.
 * This captures symbols available for export-based classification.
 */
function buildExportMap(edges: ImportEdge[]): Map<string, string[]> {
  const result = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.type === "reexport") {
      // The source file exports these symbols
      let list = result.get(edge.to);
      if (!list) {
        list = [];
        result.set(edge.to, list);
      }
      for (const sym of edge.symbols) {
        if (!list.includes(sym)) list.push(sym);
      }
    }
  }

  return result;
}

/**
 * Merge custom archetypes with built-ins. Custom archetypes with the same ID
 * override the built-in definition.
 */
function mergeArchetypes(
  builtins: ArchetypeDefinition[],
  custom?: ArchetypeDefinition[],
): ArchetypeDefinition[] {
  if (!custom || custom.length === 0) return [...builtins];

  const merged = new Map<string, ArchetypeDefinition>();
  for (const a of builtins) merged.set(a.id, a);
  for (const a of custom) merged.set(a.id, a);
  return [...merged.values()];
}

/**
 * Compute summary statistics from classifications.
 */
function computeSummary(files: FileClassification[]): ClassificationsSummary {
  const byArchetype: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let totalClassified = 0;
  let totalUnclassified = 0;

  for (const fc of files) {
    if (fc.archetype) {
      totalClassified++;
      byArchetype[fc.archetype] = (byArchetype[fc.archetype] ?? 0) + 1;
    } else {
      totalUnclassified++;
    }
    bySource[fc.source] = (bySource[fc.source] ?? 0) + 1;
  }

  return { totalClassified, totalUnclassified, byArchetype, bySource };
}

/**
 * Build a lookup map from file path to archetype ID.
 * Returns null for unclassified files.
 */
export function buildClassificationMap(
  classifications: Classifications | null | undefined,
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  if (!classifications) return map;
  for (const fc of classifications.files) {
    map.set(fc.path, fc.archetype);
  }
  return map;
}
