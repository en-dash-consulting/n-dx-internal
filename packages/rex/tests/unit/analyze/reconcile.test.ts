import { describe, it, expect } from "vitest";
import { reconcile } from "../../../src/analyze/reconcile.js";
import type { ScanResult } from "../../../src/analyze/scanners.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeScanResult(overrides: Partial<ScanResult> & { name: string }): ScanResult {
  return {
    source: "test",
    sourceFile: "test.ts",
    kind: "feature",
    ...overrides,
  };
}

function makeItem(
  overrides: Partial<PRDItem> & { id: string; title: string },
): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

describe("reconcile", () => {
  it("filters exact title matches", () => {
    const proposals = [
      makeScanResult({ name: "Login Flow" }),
      makeScanResult({ name: "Dashboard" }),
    ];
    const existing = [makeItem({ id: "1", title: "Login Flow" })];

    const { results, stats } = reconcile(proposals, existing);

    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Dashboard");
    expect(stats.total).toBe(2);
    expect(stats.alreadyTracked).toBe(1);
    expect(stats.newCount).toBe(1);
  });

  it("filters case-insensitive matches", () => {
    const proposals = [
      makeScanResult({ name: "login flow" }),
      makeScanResult({ name: "New Feature" }),
    ];
    const existing = [makeItem({ id: "1", title: "Login Flow" })];

    const { results } = reconcile(proposals, existing);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("New Feature");
  });

  it("filters substring matches", () => {
    const proposals = [
      makeScanResult({ name: "Login" }),
      makeScanResult({ name: "Payment Processing" }),
    ];
    const existing = [
      makeItem({ id: "1", title: "Login Flow" }),
    ];

    const { results } = reconcile(proposals, existing);
    // "Login" is a substring of "Login Flow", should be filtered
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Payment Processing");
  });

  it("preserves non-matching proposals", () => {
    const proposals = [
      makeScanResult({ name: "Auth" }),
      makeScanResult({ name: "Billing" }),
      makeScanResult({ name: "Reports" }),
    ];
    const existing: PRDItem[] = [];

    const { results, stats } = reconcile(proposals, existing);
    expect(results.length).toBe(3);
    expect(stats.alreadyTracked).toBe(0);
    expect(stats.newCount).toBe(3);
  });

  it("handles empty proposals list", () => {
    const { results, stats } = reconcile(
      [],
      [makeItem({ id: "1", title: "Existing" })],
    );
    expect(results).toEqual([]);
    expect(stats.total).toBe(0);
    expect(stats.newCount).toBe(0);
  });

  it("handles nested existing items", () => {
    const proposals = [
      makeScanResult({ name: "Nested Task" }),
      makeScanResult({ name: "New Thing" }),
    ];
    const existing: PRDItem[] = [
      makeItem({
        id: "1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "2",
            title: "Feature",
            level: "feature",
            children: [makeItem({ id: "3", title: "Nested Task", level: "task" })],
          }),
        ],
      }),
    ];

    const { results } = reconcile(proposals, existing);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("New Thing");
  });

  it("filters when existing title contains proposal name", () => {
    const proposals = [makeScanResult({ name: "auth" })];
    const existing = [
      makeItem({ id: "1", title: "Implement auth module" }),
    ];

    const { results } = reconcile(proposals, existing);
    expect(results.length).toBe(0);
  });

  it("filters near-duplicate proposals using similarity", () => {
    const proposals = [
      makeScanResult({ name: "fix auth bug" }),
      makeScanResult({ name: "New Feature" }),
    ];
    const existing = [
      makeItem({ id: "1", title: "fix authentication bug" }),
    ];

    const { results, stats } = reconcile(proposals, existing);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("New Feature");
    expect(stats.alreadyTracked).toBe(1);
  });

  it("filters proposals with synonymous action verbs", () => {
    const proposals = [
      makeScanResult({ name: "Add user login" }),
    ];
    const existing = [
      makeItem({ id: "1", title: "Implement user login" }),
    ];

    const { results } = reconcile(proposals, existing);
    expect(results.length).toBe(0);
  });

  it("keeps proposals with different content despite shared verb", () => {
    const proposals = [
      makeScanResult({ name: "Implement caching" }),
    ];
    const existing = [
      makeItem({ id: "1", title: "Implement auth" }),
    ];

    const { results } = reconcile(proposals, existing);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Implement caching");
  });
});
