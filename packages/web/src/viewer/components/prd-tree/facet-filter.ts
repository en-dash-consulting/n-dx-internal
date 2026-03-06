/**
 * Tag and status facet filter chips for the PRD tree search.
 *
 * Renders toggleable chip rows below the search input so users can
 * narrow results by tag and/or status. Tag chips are populated
 * dynamically from the current PRD data; status chips use the
 * canonical status list.
 *
 * Facets combine with AND logic: selecting a tag AND a status shows
 * only items that have that tag AND that status. Within the tag group,
 * AND logic applies (item must have ALL selected tags). Within the
 * status group, OR logic applies (item matches ANY selected status).
 *
 * @see ./tree-search.ts — SearchFacets type and searchTree integration
 * @see ./status-filter.ts — reuses status display config
 */

import { h } from "preact";
import { useCallback } from "preact/hooks";
import type { ItemStatus } from "./types.js";

// ── Status display config (mirrors status-filter.ts) ─────────────────────

const STATUS_FACETS: { status: ItemStatus; label: string; icon: string; cssClass: string }[] = [
  { status: "pending",     label: "Pending",     icon: "\u25CB", cssClass: "prd-status-pending" },
  { status: "in_progress", label: "In Progress", icon: "\u25D0", cssClass: "prd-status-in-progress" },
  { status: "completed",   label: "Completed",   icon: "\u25CF", cssClass: "prd-status-completed" },
  { status: "failing",     label: "Failing",     icon: "\u26A0", cssClass: "prd-status-failing" },
  { status: "blocked",     label: "Blocked",     icon: "\u2298", cssClass: "prd-status-blocked" },
  { status: "deferred",    label: "Deferred",    icon: "\u25CC", cssClass: "prd-status-deferred" },
];

// ── Component ────────────────────────────────────────────────────────────────

export interface FacetFilterProps {
  /** All unique tags found in the PRD (sorted). */
  availableTags: string[];
  /** Currently selected tag facets. */
  activeTags: Set<string>;
  /** Currently selected status facets. */
  activeStatuses: Set<ItemStatus>;
  /** Called when the set of active tags changes. */
  onTagsChange: (tags: Set<string>) => void;
  /** Called when the set of active statuses changes. */
  onStatusesChange: (statuses: Set<ItemStatus>) => void;
  /** Called to clear all facets. */
  onClearAll: () => void;
}

export function FacetFilter({
  availableTags,
  activeTags,
  activeStatuses,
  onTagsChange,
  onStatusesChange,
  onClearAll,
}: FacetFilterProps) {
  const hasActiveFacets = activeTags.size > 0 || activeStatuses.size > 0;

  const toggleTag = useCallback(
    (tag: string) => {
      const next = new Set(activeTags);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      onTagsChange(next);
    },
    [activeTags, onTagsChange],
  );

  const toggleStatus = useCallback(
    (status: ItemStatus) => {
      const next = new Set(activeStatuses);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      onStatusesChange(next);
    },
    [activeStatuses, onStatusesChange],
  );

  // Don't render anything if there are no tags to show
  if (availableTags.length === 0 && !hasActiveFacets) {
    return null;
  }

  return h(
    "div",
    { class: "prd-facet-filter", role: "group", "aria-label": "Search facets" },

    // ── Status facets ─────────────────────────────────────────────────
    h(
      "div",
      { class: "prd-facet-row" },
      h("span", { class: "prd-facet-label" }, "Status:"),
      h(
        "div",
        { class: "prd-facet-chips", role: "toolbar", "aria-label": "Status facets" },
        STATUS_FACETS.map((sf) => {
          const isActive = activeStatuses.has(sf.status);
          return h(
            "button",
            {
              key: sf.status,
              class: `prd-facet-chip prd-facet-status${isActive ? " active" : ""} ${sf.cssClass}`,
              onClick: () => toggleStatus(sf.status),
              title: `${isActive ? "Remove" : "Add"} ${sf.label.toLowerCase()} filter`,
              "aria-pressed": String(isActive),
              type: "button",
            },
            h("span", { class: "prd-facet-chip-icon" }, sf.icon),
            h("span", { class: "prd-facet-chip-label" }, sf.label),
          );
        }),
      ),
    ),

    // ── Tag facets ───────────────────────────────────────────────────
    availableTags.length > 0
      ? h(
          "div",
          { class: "prd-facet-row" },
          h("span", { class: "prd-facet-label" }, "Tags:"),
          h(
            "div",
            { class: "prd-facet-chips", role: "toolbar", "aria-label": "Tag facets" },
            availableTags.map((tag) => {
              const isActive = activeTags.has(tag);
              return h(
                "button",
                {
                  key: tag,
                  class: `prd-facet-chip prd-facet-tag${isActive ? " active" : ""}`,
                  onClick: () => toggleTag(tag),
                  title: `${isActive ? "Remove" : "Add"} "${tag}" tag filter`,
                  "aria-pressed": String(isActive),
                  type: "button",
                },
                h("span", { class: "prd-facet-chip-icon" }, "#"),
                h("span", { class: "prd-facet-chip-label" }, tag),
              );
            }),
          ),
        )
      : null,

    // ── Clear all facets button ──────────────────────────────────────
    hasActiveFacets
      ? h(
          "button",
          {
            class: "prd-facet-clear",
            onClick: onClearAll,
            title: "Clear all facet filters",
            type: "button",
          },
          "\u00d7 Clear facets",
        )
      : null,
  );
}
