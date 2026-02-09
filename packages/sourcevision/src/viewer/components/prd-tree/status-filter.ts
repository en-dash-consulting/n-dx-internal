/**
 * Status filter controls for the PRD tree view.
 *
 * Renders a row of toggleable status chips that control which items
 * are visible in the tree. All statuses are enabled by default.
 */

import { h } from "preact";
import { useCallback } from "preact/hooks";
import type { ItemStatus } from "./types.js";

/** All available statuses in display order. */
export const ALL_STATUSES: ItemStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "deferred",
  "deleted",
];

/** Human-readable labels and icons for each status. */
const STATUS_DISPLAY: Record<ItemStatus, { icon: string; label: string; cssClass: string }> = {
  pending:     { icon: "\u25CB", label: "Pending",     cssClass: "prd-status-pending" },
  in_progress: { icon: "\u25D0", label: "In Progress", cssClass: "prd-status-in-progress" },
  completed:   { icon: "\u25CF", label: "Completed",   cssClass: "prd-status-completed" },
  blocked:     { icon: "\u2298", label: "Blocked",     cssClass: "prd-status-blocked" },
  deferred:    { icon: "\u25CC", label: "Deferred",    cssClass: "prd-status-deferred" },
  deleted:     { icon: "\u2715", label: "Deleted",     cssClass: "prd-status-deleted" },
};

export interface StatusFilterProps {
  /** Currently active (visible) statuses. */
  activeStatuses: Set<ItemStatus>;
  /** Called when the set of active statuses changes. */
  onChange: (statuses: Set<ItemStatus>) => void;
}

export function StatusFilter({ activeStatuses, onChange }: StatusFilterProps) {
  const toggleStatus = useCallback(
    (status: ItemStatus) => {
      const next = new Set(activeStatuses);
      if (next.has(status)) {
        // Don't allow deselecting all statuses
        if (next.size <= 1) return;
        next.delete(status);
      } else {
        next.add(status);
      }
      onChange(next);
    },
    [activeStatuses, onChange],
  );

  const allActive = activeStatuses.size === ALL_STATUSES.length;

  const handleShowAll = useCallback(() => {
    onChange(new Set(ALL_STATUSES));
  }, [onChange]);

  const handleShowActive = useCallback(() => {
    onChange(new Set<ItemStatus>(["pending", "in_progress", "blocked"]));
  }, [onChange]);

  return h(
    "div",
    { class: "prd-status-filter", role: "group", "aria-label": "Filter by status" },
    // Filter label
    h("span", { class: "prd-status-filter-label" }, "Filter:"),
    // Status chips
    h(
      "div",
      { class: "prd-status-filter-chips" },
      ALL_STATUSES.map((status) => {
        const display = STATUS_DISPLAY[status];
        const isActive = activeStatuses.has(status);
        return h(
          "button",
          {
            key: status,
            class: `prd-status-chip${isActive ? " active" : ""} ${display.cssClass}`,
            onClick: () => toggleStatus(status),
            title: `${isActive ? "Hide" : "Show"} ${display.label.toLowerCase()} items`,
            "aria-pressed": String(isActive),
            type: "button",
          },
          h("span", { class: "prd-status-chip-icon" }, display.icon),
          h("span", { class: "prd-status-chip-label" }, display.label),
        );
      }),
    ),
    // Quick presets
    h(
      "div",
      { class: "prd-status-filter-presets" },
      h(
        "button",
        {
          class: `prd-status-preset${allActive ? " active" : ""}`,
          onClick: handleShowAll,
          title: "Show all statuses",
          type: "button",
        },
        "All",
      ),
      h(
        "button",
        {
          class: `prd-status-preset${!allActive && activeStatuses.size === 3 && activeStatuses.has("pending") && activeStatuses.has("in_progress") && activeStatuses.has("blocked") ? " active" : ""}`,
          onClick: handleShowActive,
          title: "Show only actionable items (pending, in progress, blocked)",
          type: "button",
        },
        "Active",
      ),
    ),
  );
}

/** Default set of visible statuses (everything except deleted). */
export function defaultStatusFilter(): Set<ItemStatus> {
  return new Set<ItemStatus>(["pending", "in_progress", "completed", "blocked", "deferred"]);
}
