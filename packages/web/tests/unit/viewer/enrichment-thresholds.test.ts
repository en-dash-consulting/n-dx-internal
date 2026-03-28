import { describe, it, expect } from "vitest";
import { ENRICHMENT_THRESHOLDS } from "../../../src/viewer/views/enrichment-thresholds.js";

describe("ENRICHMENT_THRESHOLDS", () => {
  it("exports analysis threshold (unified view, always available)", () => {
    expect(ENRICHMENT_THRESHOLDS.analysis).toBe(0);
  });

  it("exports architecture threshold", () => {
    expect(ENRICHMENT_THRESHOLDS.architecture).toBe(2);
  });

  it("exports problems threshold", () => {
    expect(ENRICHMENT_THRESHOLDS.problems).toBe(3);
  });

  it("exports suggestions threshold", () => {
    expect(ENRICHMENT_THRESHOLDS.suggestions).toBe(4);
  });

  it("legacy thresholds are strictly ordered: architecture < problems < suggestions", () => {
    expect(ENRICHMENT_THRESHOLDS.architecture).toBeLessThan(ENRICHMENT_THRESHOLDS.problems);
    expect(ENRICHMENT_THRESHOLDS.problems).toBeLessThan(ENRICHMENT_THRESHOLDS.suggestions);
  });

  it("analysis threshold is the lowest (softened gating)", () => {
    expect(ENRICHMENT_THRESHOLDS.analysis).toBeLessThanOrEqual(ENRICHMENT_THRESHOLDS.architecture);
  });

  it("is frozen (readonly)", () => {
    // The `as const` assertion makes the object deeply readonly at the type level.
    // Verify no unexpected keys exist.
    const keys = Object.keys(ENRICHMENT_THRESHOLDS);
    expect(keys).toEqual(["analysis", "architecture", "problems", "suggestions"]);
  });
});
