/**
 * Column switcher — dropdown control for swapping visible/hidden table columns.
 *
 * Two-step interaction:
 * 1. User clicks a hidden column to "queue" it for swap.
 * 2. User clicks a visible column to complete the swap.
 *
 * Keyboard accessible: Tab / Enter / Escape navigation, labeled throughout.
 */
import { h } from "preact";
import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import type { ColumnDef } from "../hooks/index.js";

interface ColumnSwitcherProps {
  /** All column definitions. */
  columns: ColumnDef[];
  /** Currently visible column keys. */
  visibleKeys: Set<string>;
  /** Currently hidden columns (priority-ordered). */
  hiddenColumns: ColumnDef[];
  /** Swap a hidden column for a visible one. */
  onSwap: (showKey: string, hideKey: string) => void;
  /** Reset all swaps. */
  onReset: () => void;
}

export function ColumnSwitcher({
  columns,
  visibleKeys,
  hiddenColumns,
  onSwap,
  onReset,
}: ColumnSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [swapTarget, setSwapTarget] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSwapTarget(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setSwapTarget(null);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const handleToggle = useCallback(() => {
    setOpen((p) => !p);
    setSwapTarget(null);
  }, []);

  const handleShowColumn = useCallback((hiddenKey: string) => {
    setSwapTarget(hiddenKey);
  }, []);

  const handleHideColumn = useCallback(
    (visibleKey: string) => {
      if (swapTarget) {
        onSwap(swapTarget, visibleKey);
        setSwapTarget(null);
      }
    },
    [swapTarget, onSwap],
  );

  const handleReset = useCallback(() => {
    onReset();
    setSwapTarget(null);
    setOpen(false);
  }, [onReset]);

  const visibleColumns = columns.filter((c) => visibleKeys.has(c.key));

  return h(
    "div",
    { class: "column-switcher" },

    // Toggle button
    h(
      "button",
      {
        ref: buttonRef,
        class: "column-switcher-btn",
        onClick: handleToggle,
        "aria-expanded": String(open),
        "aria-haspopup": "true",
        "aria-label": `Column visibility: ${visibleKeys.size} of ${columns.length} columns shown`,
        title: "Choose which columns to display",
      },
      "\u2630", // ☰
      ` ${visibleKeys.size}/${columns.length}`,
    ),

    // Dropdown menu
    open
      ? h(
          "div",
          {
            ref: menuRef,
            class: "column-switcher-menu",
            role: "dialog",
            "aria-label": "Column switcher",
          },

          // Contextual hint
          swapTarget
            ? h(
                "div",
                { class: "column-switcher-hint" },
                `Replace a visible column with "${hiddenColumns.find((c) => c.key === swapTarget)?.label ?? swapTarget}":`,
              )
            : h(
                "div",
                { class: "column-switcher-hint" },
                "Select a hidden column to show:",
              ),

          // Hidden columns section
          hiddenColumns.length > 0
            ? h(
                "div",
                { class: "column-switcher-section" },
                h(
                  "div",
                  { class: "column-switcher-section-label" },
                  "Hidden",
                ),
                ...hiddenColumns.map((col) =>
                  h(
                    "button",
                    {
                      key: col.key,
                      class: `column-switcher-item${swapTarget === col.key ? " selected" : ""}`,
                      onClick: () => handleShowColumn(col.key),
                      "aria-pressed": String(swapTarget === col.key),
                      "aria-label": `Show ${col.label} column`,
                    },
                    h(
                      "span",
                      { class: "column-switcher-item-label" },
                      col.label,
                    ),
                    h("span", { class: "column-switcher-item-action" }, "+"),
                  ),
                ),
              )
            : null,

          // Visible columns section (shown during swap)
          swapTarget
            ? h(
                "div",
                { class: "column-switcher-section" },
                h(
                  "div",
                  { class: "column-switcher-section-label" },
                  "Replace",
                ),
                ...visibleColumns.map((col) =>
                  h(
                    "button",
                    {
                      key: col.key,
                      class:
                        "column-switcher-item column-switcher-item-visible",
                      onClick: () => handleHideColumn(col.key),
                      "aria-label": `Hide ${col.label} column and show ${hiddenColumns.find((c) => c.key === swapTarget)?.label ?? swapTarget}`,
                    },
                    h(
                      "span",
                      { class: "column-switcher-item-label" },
                      col.label,
                    ),
                    h(
                      "span",
                      { class: "column-switcher-item-action" },
                      "\u2212",
                    ),
                  ),
                ),
              )
            : null,

          // Reset button
          h(
            "button",
            {
              class: "column-switcher-reset",
              onClick: handleReset,
              "aria-label": "Reset column visibility to defaults",
            },
            "Reset to defaults",
          ),
        )
      : null,
  );
}
