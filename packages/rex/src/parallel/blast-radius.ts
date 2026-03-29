/**
 * Blast radius computation for parallel worktree execution.
 *
 * For each PRD task, computes the set of files it is likely to modify
 * (its "blast radius"). This is used downstream to detect conflicts
 * between tasks and identify independent sets that can run in parallel.
 *
 * Signal sources:
 * 1. Zone-based expansion: extract zone IDs from task tags and expand to file sets.
 * 2. Acceptance criteria parsing: extract file paths and module names from criteria text.
 * 3. Import neighbor expansion: add 1-hop import neighbors for high-coupling files.
 * 4. Sibling heuristic: tasks sharing a parent feature union their blast radii.
 *
 * @module rex/parallel/blast-radius
 */

import type { PRDItem } from "../schema/v1.js";

// ── Lightweight input types ─────────────────────────────────────────────────
// These mirror the essential shape of sourcevision data without importing it,
// preserving domain isolation (rex ⊥ sourcevision).

/** Minimal zone representation: zone ID → set of file paths. */
export type ZoneIndex = Map<string, Set<string>>;

/** Minimal import graph: file path → set of directly connected file paths. */
export type ImportGraph = Map<string, Set<string>>;

// ── File path extraction from acceptance criteria ───────────────────────────

/**
 * Regex for explicit file paths in acceptance criteria.
 * Matches patterns like `src/foo/bar.ts`, `packages/web/index.tsx`, etc.
 * The path must contain at least one slash and end with a dot-extension.
 * Delimiters (backticks, quotes, whitespace) are consumed but not captured.
 */
const FILE_PATH_RE = /(?:^|[\s`'"(])([a-zA-Z0-9@._-]+\/[a-zA-Z0-9_./-]+\.\w{1,4})(?=[\s`'")\],;]|$)/g;

/**
 * Regex for module/component names in acceptance criteria.
 * Matches PascalCase identifiers that look like component or module names.
 * At least 2 chars, starts with uppercase.
 */
const MODULE_NAME_RE = /\b([A-Z][a-zA-Z0-9]{1,}(?:Component|Module|Service|Provider|Handler|Factory|Gateway|Store|Hook|View|Page|Layout|Router|Middleware|Controller|Manager)?)\b/g;

/**
 * Extract file paths from acceptance criteria strings.
 *
 * Looks for:
 * - Explicit file paths matching src/**\/*.ts patterns
 * - Module/component names that can be resolved against zone file sets
 */
export function extractPathsFromCriteria(criteria: string[]): {
  filePaths: Set<string>;
  moduleNames: Set<string>;
} {
  const filePaths = new Set<string>();
  const moduleNames = new Set<string>();

  for (const criterion of criteria) {
    // Extract explicit file paths
    for (const match of criterion.matchAll(FILE_PATH_RE)) {
      const path = match[1];
      // Filter out URLs and other non-file patterns
      if (!path.startsWith("http") && !path.startsWith("//")) {
        filePaths.add(path);
      }
    }

    // Extract module/component names
    for (const match of criterion.matchAll(MODULE_NAME_RE)) {
      moduleNames.add(match[1]);
    }
  }

  return { filePaths, moduleNames };
}

/**
 * Resolve module names to file paths by searching zone file sets.
 * A module name matches a file if the file's basename (without extension)
 * matches the module name (case-insensitive) or its kebab-case equivalent.
 */
export function resolveModuleNames(
  moduleNames: Set<string>,
  zones: ZoneIndex,
): Set<string> {
  const resolved = new Set<string>();
  if (moduleNames.size === 0) return resolved;

  // Pre-compute kebab-case variants for matching
  const nameVariants = new Map<string, string>();
  for (const name of moduleNames) {
    // PascalCase → kebab-case: "MyComponent" → "my-component"
    const kebab = name
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
      .toLowerCase();
    nameVariants.set(name.toLowerCase(), name);
    nameVariants.set(kebab, name);
  }

  for (const files of zones.values()) {
    for (const filePath of files) {
      // Extract basename without extension
      const lastSlash = filePath.lastIndexOf("/");
      const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
      const dotIdx = fileName.lastIndexOf(".");
      const baseName = dotIdx >= 0 ? fileName.slice(0, dotIdx) : fileName;
      const baseNameLower = baseName.toLowerCase();

      if (nameVariants.has(baseNameLower)) {
        resolved.add(filePath);
      }
    }
  }

  return resolved;
}

// ── Import neighbor expansion ───────────────────────────────────────────────

/**
 * Expand a set of file paths by adding their 1-hop import neighbors.
 * Both directions: files that import the target AND files imported by the target.
 */
export function expandImportNeighbors(
  files: Set<string>,
  imports: ImportGraph,
): Set<string> {
  const expanded = new Set(files);

  for (const file of files) {
    const neighbors = imports.get(file);
    if (neighbors) {
      for (const neighbor of neighbors) {
        expanded.add(neighbor);
      }
    }
  }

  return expanded;
}

// ── Zone-based expansion ────────────────────────────────────────────────────

/**
 * Extract zone IDs from a task's tags and expand to file sets.
 * Tags are matched directly against zone IDs (case-sensitive).
 */
export function expandZoneTags(
  tags: string[],
  zones: ZoneIndex,
): Set<string> {
  const files = new Set<string>();

  for (const tag of tags) {
    const zoneFiles = zones.get(tag);
    if (zoneFiles) {
      for (const file of zoneFiles) {
        files.add(file);
      }
    }
  }

  return files;
}

// ── Tree traversal helpers ──────────────────────────────────────────────────

/** Collect all tasks (level === "task" or "subtask") from a PRD item tree. */
function collectTasks(items: PRDItem[]): PRDItem[] {
  const tasks: PRDItem[] = [];
  function walk(item: PRDItem): void {
    if (item.level === "task" || item.level === "subtask") {
      tasks.push(item);
    }
    if (item.children) {
      for (const child of item.children) {
        walk(child);
      }
    }
  }
  for (const item of items) {
    walk(item);
  }
  return tasks;
}

/** Build a map of parentId → child task IDs for sibling heuristic. */
function buildParentChildIndex(items: PRDItem[]): Map<string, string[]> {
  const index = new Map<string, string[]>();

  function walk(item: PRDItem, parentId: string | null): void {
    const isTask = item.level === "task" || item.level === "subtask";
    if (isTask && parentId) {
      const siblings = index.get(parentId) ?? [];
      siblings.push(item.id);
      index.set(parentId, siblings);
    }
    if (item.children) {
      for (const child of item.children) {
        walk(child, item.id);
      }
    }
  }

  for (const item of items) {
    walk(item, null);
  }

  return index;
}

// ── Main blast radius computation ───────────────────────────────────────────

/**
 * Compute the blast radius for each PRD task.
 *
 * @param tasks - The PRD item tree (typically the root items array).
 * @param zones - Zone index: zone ID → set of file paths.
 * @param imports - Import graph: file → set of connected files (bidirectional).
 * @returns Map of task ID → set of file paths in the blast radius.
 */
export function blastRadius(
  tasks: PRDItem[],
  zones: ZoneIndex,
  imports: ImportGraph,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const allTasks = collectTasks(tasks);

  // Phase 1: Compute per-task blast radius from direct signals
  for (const task of allTasks) {
    const files = new Set<string>();

    // Signal 1: Zone-based expansion from tags
    if (task.tags && task.tags.length > 0) {
      const zoneFiles = expandZoneTags(task.tags, zones);
      for (const f of zoneFiles) files.add(f);
    }

    // Signal 2: Acceptance criteria parsing
    if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
      const { filePaths, moduleNames } = extractPathsFromCriteria(task.acceptanceCriteria);
      for (const f of filePaths) files.add(f);

      // Resolve module names against zone files
      const resolvedModules = resolveModuleNames(moduleNames, zones);
      for (const f of resolvedModules) files.add(f);
    }

    // Signal 3: Import neighbor expansion
    // Only expand if we have some seed files (avoid expanding nothing)
    if (files.size > 0) {
      const expanded = expandImportNeighbors(files, imports);
      // Replace with expanded set (includes originals)
      result.set(task.id, expanded);
    } else {
      result.set(task.id, files);
    }
  }

  // Phase 2: Sibling heuristic — tasks under the same parent union blast radii
  const parentChildIndex = buildParentChildIndex(tasks);
  for (const [_parentId, childIds] of parentChildIndex) {
    // Collect the union of all sibling blast radii
    const unionSet = new Set<string>();
    for (const childId of childIds) {
      const childRadius = result.get(childId);
      if (childRadius) {
        for (const f of childRadius) unionSet.add(f);
      }
    }

    // Apply the union back to all siblings
    if (unionSet.size > 0) {
      for (const childId of childIds) {
        const existing = result.get(childId);
        if (existing) {
          for (const f of unionSet) existing.add(f);
        } else {
          result.set(childId, new Set(unionSet));
        }
      }
    }
  }

  return result;
}
