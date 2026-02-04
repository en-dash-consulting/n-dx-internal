/**
 * Automatic timestamping for PRD item status changes.
 *
 * Computes the timestamp fields (`startedAt`, `completedAt`) that should
 * be set when an item's status changes. Centralises the logic so that all
 * callers (CLI, MCP, hench) produce consistent timestamps.
 *
 * Rules:
 * - `startedAt` is set the *first* time an item enters `in_progress`.
 *   If the item already has a `startedAt` it is preserved (not overwritten).
 * - `completedAt` is set when an item enters `completed`.
 *   If a completed item is forced back to a non-completed status,
 *   `completedAt` is cleared.
 * - Transitioning directly from `pending` to `completed` sets both
 *   `startedAt` (if not already set) and `completedAt`.
 *
 * @module core/timestamps
 */

import type { ItemStatus, PRDItem } from "../schema/index.js";

export interface TimestampUpdates {
  startedAt?: string | undefined;
  completedAt?: string | undefined;
}

/**
 * Compute timestamp field updates for a status transition.
 *
 * @param from    - Current item status.
 * @param to      - New target status.
 * @param existing - Optional existing timestamp fields on the item.
 * @returns Object with timestamp fields to merge into the item update.
 *          Only includes keys that should change; empty object means no
 *          timestamp updates are needed.
 */
export function computeTimestampUpdates(
  from: ItemStatus,
  to: ItemStatus,
  existing?: Pick<PRDItem, "startedAt" | "completedAt">,
): TimestampUpdates {
  if (from === to) return {};

  const updates: TimestampUpdates = {};
  const now = new Date().toISOString();

  // Set startedAt when entering in_progress (or skipping directly to completed)
  if (to === "in_progress" || to === "completed") {
    if (!existing?.startedAt) {
      updates.startedAt = now;
    }
  }

  // Set completedAt when entering completed
  if (to === "completed") {
    updates.completedAt = now;
  }

  // Clear completedAt when leaving completed (forced transition)
  if (from === "completed" && to !== "completed") {
    updates.completedAt = undefined;
  }

  return updates;
}
