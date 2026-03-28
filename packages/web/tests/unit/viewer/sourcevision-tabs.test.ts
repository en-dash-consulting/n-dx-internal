import { describe, it, expect } from "vitest";
import {
  SOURCEVISION_TABS,
  SOURCEVISION_TAB_IDS,
  type SourceVisionTab,
  type SourceVisionTabId,
} from "../../../src/viewer/views/sourcevision-tabs.js";
import { ENRICHMENT_THRESHOLDS } from "../../../src/viewer/views/enrichment-thresholds.js";

describe("SOURCEVISION_TABS", () => {
  it("defines exactly 6 tabs (explorer replaces files+graph, endpoints replaces routes, pr-markdown removed)", () => {
    expect(SOURCEVISION_TABS).toHaveLength(6);
  });

  it("every tab has required fields", () => {
    for (const tab of SOURCEVISION_TABS) {
      expect(tab.id).toBeTruthy();
      expect(typeof tab.icon).toBe("string");
      expect(tab.label).toBeTruthy();
      expect(typeof tab.minPass).toBe("number");
      expect(tab.minPass).toBeGreaterThanOrEqual(0);
    }
  });

  it("tab IDs are unique", () => {
    const ids = SOURCEVISION_TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains all expected tab IDs", () => {
    const ids = SOURCEVISION_TABS.map((t) => t.id);
    expect(ids).toContain("overview");
    expect(ids).toContain("explorer");
    expect(ids).toContain("zones");
    expect(ids).toContain("endpoints");
    expect(ids).toContain("analysis");
    expect(ids).toContain("config-surface");
  });

  it("does not contain legacy tabs replaced by consolidation or migration", () => {
    const ids = SOURCEVISION_TABS.map((t) => t.id);
    // architecture/problems/suggestions → analysis
    expect(ids).not.toContain("architecture");
    expect(ids).not.toContain("problems");
    expect(ids).not.toContain("suggestions");
    // files/graph → explorer
    expect(ids).not.toContain("files");
    expect(ids).not.toContain("graph");
    // routes → endpoints
    expect(ids).not.toContain("routes");
    // pr-markdown → /pr-description skill
    expect(ids).not.toContain("pr-markdown");
  });

  it("unified analysis tab has minPass 0 (softened enrichment gating)", () => {
    const analysis = SOURCEVISION_TABS.find((t) => t.id === "analysis")!;
    expect(analysis).toBeDefined();
    expect(analysis.minPass).toBe(ENRICHMENT_THRESHOLDS.analysis);
    expect(analysis.minPass).toBe(0);
  });

  it("all tabs have minPass of 0", () => {
    for (const tab of SOURCEVISION_TABS) {
      expect(tab.minPass).toBe(0);
    }
  });
});

describe("SOURCEVISION_TAB_IDS", () => {
  it("matches the IDs extracted from SOURCEVISION_TABS", () => {
    expect(SOURCEVISION_TAB_IDS).toEqual(SOURCEVISION_TABS.map((t) => t.id));
  });

  it("has the same length as SOURCEVISION_TABS", () => {
    expect(SOURCEVISION_TAB_IDS).toHaveLength(SOURCEVISION_TABS.length);
  });
});
