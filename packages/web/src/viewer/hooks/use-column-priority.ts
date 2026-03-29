/**
 * Column-priority hook — responsive column visibility for data tables.
 *
 * Each column carries a numeric priority. At narrow container widths the
 * system hides low-priority columns first, keeping the total visible count
 * determined by available width. Users can swap hidden columns for visible
 * ones via the companion ColumnSwitcher component — the total count stays
 * constant so the layout never shifts.
 */
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import type { RefObject } from "preact";

// ── Types ───────────────────────────────────────────────────────────

export interface ColumnDef {
  /** Unique column identifier. */
  key: string;
  /** Display label for the column header. */
  label: string;
  /** Higher number = more important. Shown first at narrow widths. */
  priority: number;
  /** Minimum pixel width this column needs (default: 100). */
  minWidth?: number;
}

export interface ColumnPriorityResult {
  /** Set of column keys that should be rendered. */
  visibleKeys: Set<string>;
  /** Columns currently hidden, ordered by priority descending. */
  hiddenColumns: ColumnDef[];
  /** Maximum columns that fit at current width. */
  maxColumns: number;
  /** Swap a hidden column into visibility, replacing a visible one. */
  swapColumn: (showKey: string, hideKey: string) => void;
  /** Reset all user swaps back to priority defaults. */
  resetSwaps: () => void;
  /** Whether any columns are currently hidden. */
  hasHiddenColumns: boolean;
}

// ── Pure logic (testable without DOM) ───────────────────────────────

const DEFAULT_MIN_WIDTH = 100;

/**
 * Compute which columns are visible given available width and priorities.
 *
 * Algorithm:
 * 1. Calculate how many columns fit (containerWidth / avgMinWidth).
 * 2. If all fit → show everything.
 * 3. Otherwise take the top-N by priority as the default visible set.
 * 4. Apply user swaps: for each (showKey, hideKey) pair, swap them if the
 *    showKey was default-hidden and hideKey is currently visible.
 */
export function computeVisibleColumns(
  columns: ColumnDef[],
  containerWidth: number,
  swaps: Map<string, string> = new Map(),
): { visibleKeys: Set<string>; hiddenColumns: ColumnDef[]; maxColumns: number } {
  if (columns.length === 0) {
    return { visibleKeys: new Set(), hiddenColumns: [], maxColumns: 0 };
  }

  // Average min-width drives the column-count budget
  const totalMinWidth = columns.reduce(
    (sum, c) => sum + (c.minWidth ?? DEFAULT_MIN_WIDTH),
    0,
  );
  const avgMinWidth = totalMinWidth / columns.length;
  const maxColumns = Math.max(1, Math.floor(containerWidth / avgMinWidth));

  // All columns fit — nothing to hide
  if (maxColumns >= columns.length) {
    return {
      visibleKeys: new Set(columns.map((c) => c.key)),
      hiddenColumns: [],
      maxColumns,
    };
  }

  // Sort by priority descending (highest first)
  const sorted = [...columns].sort((a, b) => b.priority - a.priority);

  // Default: top N by priority are visible
  const defaultVisible = new Set(sorted.slice(0, maxColumns).map((c) => c.key));

  // Apply user swaps
  const visibleKeys = new Set(defaultVisible);
  for (const [showKey, hideKey] of swaps) {
    // Only apply if showKey is hidden and hideKey is visible
    if (!visibleKeys.has(showKey) && visibleKeys.has(hideKey)) {
      visibleKeys.delete(hideKey);
      visibleKeys.add(showKey);
    }
  }

  // Hidden list in priority order (highest first)
  const hiddenColumns = sorted.filter((c) => !visibleKeys.has(c.key));

  return { visibleKeys, hiddenColumns, maxColumns };
}

// ── Hook ────────────────────────────────────────────────────────────

/**
 * Observe a container's width and compute responsive column visibility.
 *
 * Returns the set of visible/hidden columns and swap controls for the
 * ColumnSwitcher component.
 */
export function useColumnPriority(
  containerRef: RefObject<HTMLElement>,
  columns: ColumnDef[],
): ColumnPriorityResult {
  const [containerWidth, setContainerWidth] = useState(Infinity);
  const [swaps, setSwaps] = useState<Map<string, string>>(new Map());

  // Observe container width via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setContainerWidth(el.clientWidth || Infinity);

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width =
          entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        setContainerWidth(width);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  const result = useMemo(
    () => computeVisibleColumns(columns, containerWidth, swaps),
    [columns, containerWidth, swaps],
  );

  const swapColumn = useCallback((showKey: string, hideKey: string) => {
    setSwaps((prev) => {
      const next = new Map(prev);
      next.set(showKey, hideKey);
      return next;
    });
  }, []);

  const resetSwaps = useCallback(() => {
    setSwaps(new Map());
  }, []);

  // Auto-clear swaps when all columns fit (e.g. window resized wider)
  useEffect(() => {
    if (result.maxColumns >= columns.length && swaps.size > 0) {
      setSwaps(new Map());
    }
  }, [result.maxColumns, columns.length, swaps.size]);

  return {
    ...result,
    swapColumn,
    resetSwaps,
    hasHiddenColumns: result.hiddenColumns.length > 0,
  };
}
