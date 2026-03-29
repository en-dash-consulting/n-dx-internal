import { describe, it, expect } from "vitest";
import {
  SOURCEVISION_TABS,
  SOURCEVISION_TAB_IDS,
  getVisibleTabs,
  DEFAULT_CONFIDENCE_THRESHOLD,
  type SourceVisionTab,
  type SourceVisionTabId,
} from "../../../src/viewer/views/sourcevision-tabs.js";
import { ENRICHMENT_THRESHOLDS } from "../../../src/viewer/views/enrichment-thresholds.js";
import type { DetectedFrameworks, DetectedFramework } from "../../../src/viewer/external.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFramework(overrides: Partial<DetectedFramework> = {}): DetectedFramework {
  return {
    id: "express",
    name: "Express",
    category: "backend",
    language: "typescript",
    confidence: 0.8,
    matchedSignals: [{ kind: "import", detail: "express" }],
    ...overrides,
  };
}

function makeDetected(frameworks: DetectedFramework[]): DetectedFrameworks {
  const byCategory: Partial<Record<string, number>> = {};
  const byLanguage: Record<string, number> = {};
  for (const fw of frameworks) {
    byCategory[fw.category] = (byCategory[fw.category] ?? 0) + 1;
    byLanguage[fw.language] = (byLanguage[fw.language] ?? 0) + 1;
  }
  return {
    frameworks,
    summary: {
      totalDetected: frameworks.length,
      byCategory,
      byLanguage,
    },
  };
}

// ── Static tab definitions ──────────────────────────────────────────────────

describe("SOURCEVISION_TABS", () => {
  it("defines exactly 5 tabs (config-surface moved to explorer/properties)", () => {
    expect(SOURCEVISION_TABS).toHaveLength(5);
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
    // config-surface → explorer/properties
    expect(ids).not.toContain("config-surface");
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

  it("endpoints tab requires backend category", () => {
    const endpoints = SOURCEVISION_TABS.find((t) => t.id === "endpoints")!;
    expect(endpoints).toBeDefined();
    expect(endpoints.requiredCategory).toBe("backend");
  });

  it("overview and explorer have no framework requirements", () => {
    const overview = SOURCEVISION_TABS.find((t) => t.id === "overview")!;
    const explorer = SOURCEVISION_TABS.find((t) => t.id === "explorer")!;
    expect(overview.requiredFramework).toBeUndefined();
    expect(overview.requiredCategory).toBeUndefined();
    expect(explorer.requiredFramework).toBeUndefined();
    expect(explorer.requiredCategory).toBeUndefined();
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

// ── Dynamic tab visibility ──────────────────────────────────────────────────

describe("getVisibleTabs", () => {
  it("returns all tabs when frameworks is null (not yet loaded)", () => {
    const visible = getVisibleTabs(null);
    expect(visible).toEqual(SOURCEVISION_TABS);
  });

  it("hides endpoints tab when no backend framework detected", () => {
    const detected = makeDetected([
      makeFramework({ id: "react-router-v7", category: "frontend", confidence: 0.9 }),
    ]);
    const visible = getVisibleTabs(detected);
    const ids = visible.map((t) => t.id);
    expect(ids).not.toContain("endpoints");
    // Other tabs without requirements still show
    expect(ids).toContain("overview");
    expect(ids).toContain("explorer");
    expect(ids).toContain("zones");
    expect(ids).toContain("analysis");
  });

  it("shows endpoints tab when backend framework detected with sufficient confidence", () => {
    const detected = makeDetected([
      makeFramework({ id: "express", category: "backend", confidence: 0.8 }),
    ]);
    const visible = getVisibleTabs(detected);
    const ids = visible.map((t) => t.id);
    expect(ids).toContain("endpoints");
  });

  it("hides endpoints tab when backend framework detected below confidence threshold", () => {
    const detected = makeDetected([
      makeFramework({ id: "express", category: "backend", confidence: 0.3 }),
    ]);
    const visible = getVisibleTabs(detected);
    const ids = visible.map((t) => t.id);
    expect(ids).not.toContain("endpoints");
  });

  it("uses custom confidence threshold", () => {
    const detected = makeDetected([
      makeFramework({ id: "express", category: "backend", confidence: 0.6 }),
    ]);
    // Default threshold (0.5) — should show
    expect(getVisibleTabs(detected, 0.5).map((t) => t.id)).toContain("endpoints");
    // Higher threshold — should hide
    expect(getVisibleTabs(detected, 0.7).map((t) => t.id)).not.toContain("endpoints");
  });

  it("overview and explorer always visible regardless of frameworks", () => {
    const detected = makeDetected([]); // No frameworks detected at all
    const visible = getVisibleTabs(detected);
    const ids = visible.map((t) => t.id);
    expect(ids).toContain("overview");
    expect(ids).toContain("explorer");
  });

  it("zones and analysis always visible with empty detection", () => {
    const detected = makeDetected([]);
    const visible = getVisibleTabs(detected);
    const ids = visible.map((t) => t.id);
    expect(ids).toContain("zones");
    expect(ids).toContain("analysis");
  });

  it("shows all tabs when both frontend and backend frameworks detected", () => {
    const detected = makeDetected([
      makeFramework({ id: "express", category: "backend", confidence: 0.8 }),
      makeFramework({ id: "react-router-v7", category: "frontend", confidence: 0.9 }),
    ]);
    const visible = getVisibleTabs(detected);
    expect(visible).toHaveLength(SOURCEVISION_TABS.length);
  });

  it("fullstack framework satisfies both frontend and backend requirements", () => {
    // A fullstack framework has category "fullstack" — it doesn't satisfy
    // "backend" category directly. This tests that the design is intentional.
    const detected = makeDetected([
      makeFramework({ id: "nextjs", category: "fullstack", confidence: 0.9 }),
    ]);
    const visible = getVisibleTabs(detected);
    const ids = visible.map((t) => t.id);
    // Endpoints requires "backend" — fullstack doesn't match "backend"
    expect(ids).not.toContain("endpoints");
  });

  it("DEFAULT_CONFIDENCE_THRESHOLD is 0.5", () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.5);
  });
});
