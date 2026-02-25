/**
 * Atomic PRD item creation from selected recommendations.
 *
 * Replaces the previous inline accept loop in the recommend CLI command
 * with a function that validates, creates, and persists items atomically.
 * If any validation fails, no items are created (all-or-nothing).
 *
 * Uses the same validation pipeline as `cmdAdd`:
 * - Level hierarchy validation for parent-child relationships
 * - DAG integrity checks (no duplicate IDs, no orphan blockedBy refs)
 * - Schema validation via store.saveDocument()
 *
 * @module recommend/create-from-recommendations
 */

import { randomUUID } from "node:crypto";
import type { PRDStore } from "../store/types.js";
import type { PRDItem, ItemLevel, Priority } from "../schema/index.js";
import { LEVEL_HIERARCHY } from "../schema/index.js";
import { findItem, insertChild } from "../core/tree.js";
import { validateDAG } from "../core/dag.js";

// ── Types ────────────────────────────────────────────────────────────

/**
 * Metadata carried forward from the recommendation's source findings.
 * Persisted on created PRDItems for traceability.
 */
export interface RecommendationMeta {
  /** Content hashes of the source findings that produced this recommendation. */
  findingHashes?: string[];
  /** Category of the grouped findings (e.g. "auth", "perf", "security"). */
  category?: string;
  /** Distribution of finding severities in this recommendation group. */
  severityDistribution?: Record<string, number>;
  /** Total number of findings that contributed to this recommendation. */
  findingCount?: number;
}

/**
 * Enriched recommendation carrying all metadata needed for PRD item creation.
 *
 * This is the input type for {@link createItemsFromRecommendations}.
 * Callers build these from whatever recommendation source they have
 * (sourcevision findings, manual input, etc.).
 */
export interface EnrichedRecommendation {
  /** Title for the PRD item. */
  title: string;
  /** PRD hierarchy level (epic, feature, task, subtask). */
  level: ItemLevel;
  /** Description text for the PRD item. */
  description: string;
  /** Priority derived from finding severities. */
  priority: Priority;
  /** Source identifier (e.g. "sourcevision"). */
  source: string;
  /** Parent PRD item ID. When omitted, item is added at root level. */
  parentId?: string;
  /** Tags to apply to the created item. */
  tags?: string[];
  /** Recommendation metadata for traceability. */
  meta?: RecommendationMeta;
}

/**
 * Result of a successful batch creation.
 */
export interface CreationResult {
  /** Items that were created, in order. */
  created: Array<{
    id: string;
    title: string;
    level: ItemLevel;
    parentId?: string;
  }>;
}

// ── Validation ───────────────────────────────────────────────────────

/**
 * Validate that an item can be placed under the given parent (or at root).
 *
 * When a parent is specified, validates the level hierarchy (mirrors cmdAdd).
 * When no parent is specified, root placement is allowed for any level that
 * has no strict parent-only constraint (subtasks). This is intentionally more
 * permissive than cmdAdd for root items, matching the existing recommend
 * behavior where features are created at root level from sourcevision findings.
 */
function validatePlacement(
  item: PRDItem,
  parentId: string | undefined,
  docItems: PRDItem[],
): string | null {
  const allowedParents = LEVEL_HIERARCHY[item.level];
  if (!allowedParents) {
    return `Unknown level "${item.level}" for item "${item.title}".`;
  }

  const allowedParentLevels = allowedParents.filter(
    (p): p is ItemLevel => p !== null,
  );

  if (parentId) {
    // Validate parent exists and level hierarchy is respected
    const parentEntry = findItem(docItems, parentId);
    if (!parentEntry) {
      return `Parent "${parentId}" not found for item "${item.title}".`;
    }
    if (
      allowedParentLevels.length > 0 &&
      !allowedParentLevels.includes(parentEntry.item.level)
    ) {
      const parentNames = allowedParentLevels.join(" or ");
      return (
        `A ${item.level} must be a child of a ${parentNames}, ` +
        `but "${parentId}" is a ${parentEntry.item.level}.`
      );
    }
  } else {
    // Root placement: only reject levels that strictly require a parent.
    // Subtasks always need a task parent; other levels are allowed at root
    // for recommendation workflows (e.g. features from sourcevision).
    const canBeRoot = allowedParents.includes(null);
    if (!canBeRoot && allowedParentLevels.length > 0) {
      // Only block if every allowed parent is a specific level (e.g. subtask→task)
      // Allow epics, features, and tasks at root for recommendation flexibility
      const isStrictlyChildOnly =
        allowedParentLevels.length > 0 && item.level === "subtask";
      if (isStrictlyChildOnly) {
        const parentNames = allowedParentLevels.join(" or ");
        return `A ${item.level} requires a parent (${parentNames}).`;
      }
    }
  }

  return null;
}

// ── Core creation ────────────────────────────────────────────────────

/**
 * Create PRD items from selected recommendations atomically.
 *
 * All items are validated upfront, then persisted in a single
 * `saveDocument()` call. If any validation fails, no items are created.
 *
 * Follows the same patterns as `cmdAdd`:
 * - Level hierarchy validation
 * - DAG integrity checks
 * - Schema validation (via saveDocument)
 * - Execution log entries for each created item
 *
 * @param store - The PRD store to read from and write to.
 * @param recommendations - Enriched recommendations to create items from.
 * @returns Creation result with IDs and metadata of created items.
 * @throws If validation fails for any item (atomic: zero items are created).
 */
export async function createItemsFromRecommendations(
  store: PRDStore,
  recommendations: readonly EnrichedRecommendation[],
): Promise<CreationResult> {
  if (recommendations.length === 0) {
    return { created: [] };
  }

  // 1. Build PRDItems from recommendations
  const pending: Array<{ item: PRDItem; parentId?: string }> = [];
  for (const rec of recommendations) {
    const item: PRDItem = {
      id: randomUUID(),
      title: rec.title,
      status: "pending",
      level: rec.level,
      description: rec.description,
      priority: rec.priority,
      source: rec.source,
    };

    if (rec.tags && rec.tags.length > 0) {
      item.tags = rec.tags;
    }

    // Preserve recommendation metadata for traceability
    if (rec.meta) {
      item.recommendationMeta = rec.meta;
    }

    pending.push({ item, parentId: rec.parentId });
  }

  // 2. Load current document for validation
  const doc = await store.loadDocument();

  // 3. Validate placement (level hierarchy) for each item
  const placementErrors: string[] = [];
  for (const { item, parentId } of pending) {
    const err = validatePlacement(item, parentId, doc.items);
    if (err) placementErrors.push(err);
  }
  if (placementErrors.length > 0) {
    throw new Error(
      `Placement validation failed:\n${placementErrors.join("\n")}`,
    );
  }

  // 4. Add all items to the in-memory document
  for (const { item, parentId } of pending) {
    if (parentId) {
      const inserted = insertChild(doc.items, parentId, item);
      if (!inserted) {
        throw new Error(
          `Failed to insert "${item.title}" under parent "${parentId}".`,
        );
      }
    } else {
      doc.items.push(item);
    }
  }

  // 5. Validate DAG integrity with all new items in place
  const dagResult = validateDAG(doc.items);
  if (!dagResult.valid) {
    throw new Error(
      `DAG validation failed after adding recommendations: ${dagResult.errors.join("; ")}`,
    );
  }

  // 6. Persist atomically — single write for all items
  await store.saveDocument(doc);

  // 7. Log creation events
  const created: CreationResult["created"] = [];
  for (const { item, parentId } of pending) {
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "item_added",
      itemId: item.id,
      detail: `Added ${item.level} from recommendation: ${item.title}`,
    });
    created.push({
      id: item.id,
      title: item.title,
      level: item.level,
      parentId,
    });
  }

  return { created };
}
