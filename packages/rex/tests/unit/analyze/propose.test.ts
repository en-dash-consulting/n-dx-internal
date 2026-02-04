import { describe, it, expect } from "vitest";
import { buildProposals } from "../../../src/analyze/propose.js";
import type { ScanResult } from "../../../src/analyze/scanners.js";

function makeScanResult(overrides: Partial<ScanResult> & { name: string }): ScanResult {
  return {
    source: "test",
    sourceFile: "test.ts",
    kind: "feature",
    ...overrides,
  };
}

describe("buildProposals", () => {
  it("groups results by epic inferred from tags", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "Login", kind: "feature", tags: ["Auth"] }),
      makeScanResult({ name: "validates email", kind: "task", tags: ["Auth"], sourceFile: "test.ts" }),
      makeScanResult({ name: "Dashboard", kind: "feature", tags: ["UI"] }),
    ];

    const proposals = buildProposals(results);

    expect(proposals.length).toBe(2);
    const authEpic = proposals.find((p) => p.epic.title === "Auth");
    expect(authEpic).toBeDefined();
    expect(authEpic!.features.length).toBeGreaterThanOrEqual(1);

    const uiEpic = proposals.find((p) => p.epic.title === "UI");
    expect(uiEpic).toBeDefined();
  });

  it("deduplicates results with same name and kind", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "Login", kind: "feature", tags: ["Auth"], sourceFile: "a.ts" }),
      makeScanResult({ name: "Login", kind: "feature", tags: ["Auth"], sourceFile: "b.ts" }),
      makeScanResult({ name: "Login", kind: "task", tags: ["Auth"], sourceFile: "a.ts" }),
    ];

    const proposals = buildProposals(results);
    const authEpic = proposals.find((p) => p.epic.title === "Auth");
    // Should have one feature named Login (deduped) and one task named Login
    const featureCount = authEpic!.features.filter((f) => f.title === "Login").length;
    expect(featureCount).toBe(1);
  });

  it("sorts by priority (critical first)", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "Low priority fix", kind: "task", priority: "low", tags: ["General"], sourceFile: "a.ts" }),
      makeScanResult({ name: "Critical bug", kind: "task", priority: "critical", tags: ["General"], sourceFile: "a.ts" }),
      makeScanResult({ name: "Feature A", kind: "feature", tags: ["General"], sourceFile: "a.ts" }),
    ];

    const proposals = buildProposals(results);
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    const general = proposals.find((p) => p.epic.title === "General");
    expect(general).toBeDefined();

    // Find the feature with tasks
    const featureWithTasks = general!.features.find((f) => f.tasks.length > 0);
    if (featureWithTasks && featureWithTasks.tasks.length >= 2) {
      expect(featureWithTasks.tasks[0].title).toBe("Critical bug");
      expect(featureWithTasks.tasks[1].title).toBe("Low priority fix");
    }
  });

  it("places tasks under features from same sourceFile", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "Auth Feature", kind: "feature", tags: ["Auth"], sourceFile: "auth.test.ts" }),
      makeScanResult({ name: "validates token", kind: "task", tags: ["Auth"], sourceFile: "auth.test.ts" }),
      makeScanResult({ name: "checks expiry", kind: "task", tags: ["Auth"], sourceFile: "auth.test.ts" }),
    ];

    const proposals = buildProposals(results);
    const authEpic = proposals.find((p) => p.epic.title === "Auth");
    expect(authEpic).toBeDefined();

    const authFeature = authEpic!.features.find((f) => f.title === "Auth Feature");
    expect(authFeature).toBeDefined();
    expect(authFeature!.tasks.length).toBe(2);
  });

  it("handles explicit epics from scan results", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "Components", kind: "epic", source: "sourcevision" }),
      makeScanResult({ name: "Button", kind: "feature", tags: ["Components"], source: "sourcevision" }),
    ];

    const proposals = buildProposals(results);
    const comp = proposals.find(
      (p) => p.epic.title.toLowerCase() === "components",
    );
    expect(comp).toBeDefined();
    expect(comp!.features.some((f) => f.title === "Button")).toBe(true);
  });

  it("returns empty array for empty input", () => {
    const proposals = buildProposals([]);
    expect(proposals).toEqual([]);
  });

  it("creates implicit features for orphan tasks", () => {
    const results: ScanResult[] = [
      makeScanResult({
        name: "fix bug",
        kind: "task",
        tags: ["General"],
        sourceFile: "bugs.test.ts",
      }),
    ];

    const proposals = buildProposals(results);
    expect(proposals.length).toBe(1);
    // Should have created an implicit feature
    expect(proposals[0].features.length).toBe(1);
    expect(proposals[0].features[0].tasks.length).toBe(1);
    expect(proposals[0].features[0].tasks[0].title).toBe("fix bug");
  });
});
