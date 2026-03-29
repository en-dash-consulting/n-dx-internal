import { describe, it, expect } from "vitest";
import { computeVisibleColumns } from "../../../src/viewer/hooks/use-column-priority.js";
import type { ColumnDef } from "../../../src/viewer/hooks/use-column-priority.js";

function col(key: string, priority: number, minWidth = 100): ColumnDef {
  return { key, label: key.charAt(0).toUpperCase() + key.slice(1), priority, minWidth };
}

describe("computeVisibleColumns", () => {
  it("returns empty sets for empty column list", () => {
    const result = computeVisibleColumns([], 1000);
    expect(result.visibleKeys.size).toBe(0);
    expect(result.hiddenColumns).toHaveLength(0);
    expect(result.maxColumns).toBe(0);
  });

  it("shows all columns when container is wide enough", () => {
    const columns = [col("a", 3), col("b", 2), col("c", 1)];
    const result = computeVisibleColumns(columns, 500);

    expect(result.visibleKeys.size).toBe(3);
    expect(result.hiddenColumns).toHaveLength(0);
    expect(result.maxColumns).toBe(5); // 500 / 100 = 5, >= 3
  });

  it("hides lowest-priority columns at narrow widths", () => {
    const columns = [
      col("name", 10),
      col("file", 8),
      col("zone", 6),
      col("type", 4),
      col("line", 2),
    ];
    // 250px / avg 100px = 2 columns max
    const result = computeVisibleColumns(columns, 250);

    expect(result.maxColumns).toBe(2);
    expect(result.visibleKeys.has("name")).toBe(true);
    expect(result.visibleKeys.has("file")).toBe(true);
    expect(result.visibleKeys.has("zone")).toBe(false);
    expect(result.visibleKeys.has("type")).toBe(false);
    expect(result.visibleKeys.has("line")).toBe(false);
    expect(result.hiddenColumns).toHaveLength(3);
  });

  it("hidden columns are ordered by priority descending", () => {
    const columns = [
      col("a", 10),
      col("b", 8),
      col("c", 6),
      col("d", 4),
      col("e", 2),
    ];
    const result = computeVisibleColumns(columns, 250);

    expect(result.hiddenColumns.map((c) => c.key)).toEqual(["c", "d", "e"]);
  });

  it("always shows at least one column", () => {
    const columns = [col("name", 1)];
    const result = computeVisibleColumns(columns, 10); // very narrow

    expect(result.maxColumns).toBe(1);
    expect(result.visibleKeys.has("name")).toBe(true);
    expect(result.hiddenColumns).toHaveLength(0);
  });

  it("respects per-column minWidth for budget calculation", () => {
    const columns = [
      col("narrow", 3, 50),   // 50px min
      col("wide", 2, 200),    // 200px min
      col("medium", 1, 100),  // 100px min
    ];
    // avgMinWidth = (50 + 200 + 100) / 3 ≈ 116.67
    // 250 / 116.67 ≈ 2 columns max
    const result = computeVisibleColumns(columns, 250);

    expect(result.maxColumns).toBe(2);
    expect(result.visibleKeys.has("narrow")).toBe(true);  // priority 3
    expect(result.visibleKeys.has("wide")).toBe(true);    // priority 2
    expect(result.visibleKeys.has("medium")).toBe(false);  // priority 1
  });

  // ── Swap tests ──────────────────────────────────────────────────

  it("applies a valid swap: hidden column shown, visible column hidden", () => {
    const columns = [
      col("a", 10),
      col("b", 8),
      col("c", 6),
      col("d", 4),
    ];
    // 200px = 2 columns: a, b visible; c, d hidden
    const swaps = new Map([["c", "b"]]); // show c, hide b
    const result = computeVisibleColumns(columns, 200, swaps);

    expect(result.visibleKeys.has("a")).toBe(true);
    expect(result.visibleKeys.has("c")).toBe(true);
    expect(result.visibleKeys.has("b")).toBe(false);
    expect(result.visibleKeys.has("d")).toBe(false);
    expect(result.visibleKeys.size).toBe(2); // count unchanged
  });

  it("ignores invalid swap (both already visible)", () => {
    const columns = [col("a", 10), col("b", 8), col("c", 6)];
    // 200px = 2 visible: a, b
    const swaps = new Map([["a", "b"]]); // both visible → no-op
    const result = computeVisibleColumns(columns, 200, swaps);

    expect(result.visibleKeys.has("a")).toBe(true);
    expect(result.visibleKeys.has("b")).toBe(true);
    expect(result.visibleKeys.size).toBe(2);
  });

  it("ignores invalid swap (both already hidden)", () => {
    const columns = [
      col("a", 10),
      col("b", 8),
      col("c", 6),
      col("d", 4),
    ];
    // 200px = 2 visible: a, b; hidden: c, d
    const swaps = new Map([["c", "d"]]); // c hidden, d also hidden → no-op
    const result = computeVisibleColumns(columns, 200, swaps);

    expect(result.visibleKeys.has("a")).toBe(true);
    expect(result.visibleKeys.has("b")).toBe(true);
    expect(result.visibleKeys.size).toBe(2);
  });

  it("applies multiple swaps", () => {
    const columns = [
      col("a", 10),
      col("b", 8),
      col("c", 6),
      col("d", 4),
    ];
    // 200px = 2 visible: a, b
    const swaps = new Map([
      ["c", "a"], // show c, hide a
      ["d", "b"], // show d, hide b
    ]);
    const result = computeVisibleColumns(columns, 200, swaps);

    expect(result.visibleKeys.has("c")).toBe(true);
    expect(result.visibleKeys.has("d")).toBe(true);
    expect(result.visibleKeys.has("a")).toBe(false);
    expect(result.visibleKeys.has("b")).toBe(false);
    expect(result.visibleKeys.size).toBe(2);
  });

  it("swaps do not change total visible count", () => {
    const columns = [
      col("a", 10),
      col("b", 8),
      col("c", 6),
      col("d", 4),
      col("e", 2),
    ];
    // 300px = 3 visible
    const swaps = new Map([["d", "b"]]);
    const result = computeVisibleColumns(columns, 300, swaps);

    expect(result.visibleKeys.size).toBe(3);
    expect(result.hiddenColumns).toHaveLength(2);
  });

  it("swaps are ignored when all columns fit (desktop width)", () => {
    const columns = [col("a", 3), col("b", 2), col("c", 1)];
    const swaps = new Map([["c", "a"]]);
    const result = computeVisibleColumns(columns, 1000, swaps);

    // All fit, swaps have no effect
    expect(result.visibleKeys.size).toBe(3);
    expect(result.hiddenColumns).toHaveLength(0);
  });
});
