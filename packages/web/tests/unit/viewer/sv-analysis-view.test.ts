// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { SvAnalysisView } from "../../../src/viewer/views/sv-analysis.js";
import type { LoadedData } from "../../../src/viewer/types.js";

function makeData(overrides: Partial<LoadedData["zones"]> = {}, importsOverride?: LoadedData["imports"]): LoadedData {
  return {
    manifest: null,
    inventory: null,
    imports: importsOverride ?? null,
    zones: {
      enrichmentPass: 0,
      communities: [],
      crossings: [],
      findings: [],
      insights: [],
      zones: [],
      ...overrides,
    } as LoadedData["zones"],
    components: null,
    callGraph: null,
    classifications: null,
  };
}

describe("SvAnalysisView", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
  });

  it("renders with zero findings and no enrichment", () => {
    const data = makeData({ enrichmentPass: 0 });
    render(h(SvAnalysisView, { data, onSelect: vi.fn() }), root);

    expect(root.textContent).toContain("Analysis");
    expect(root.textContent).toContain("0 findings");
  });

  it("shows enrichment notice when categories are pending", () => {
    const data = makeData({ enrichmentPass: 1 });
    render(h(SvAnalysisView, { data, onSelect: vi.fn() }), root);

    expect(root.textContent).toContain("Additional findings available");
    expect(root.textContent).toContain("Architecture");
    expect(root.textContent).toContain("pass 2");
    expect(root.textContent).toContain("Problems");
    expect(root.textContent).toContain("Suggestions");
  });

  it("does not show enrichment notice when all passes met", () => {
    const data = makeData({ enrichmentPass: 5 });
    render(h(SvAnalysisView, { data, onSelect: vi.fn() }), root);

    expect(root.querySelector(".analysis-enrichment-notice")).toBeNull();
  });

  it("renders all finding types in stat cards", () => {
    const data = makeData({
      enrichmentPass: 5,
      findings: [
        { type: "pattern", severity: "info", scope: "global", text: "Pattern A", pass: 2 },
        { type: "relationship", severity: "info", scope: "global", text: "Rel B", pass: 2 },
        { type: "anti-pattern", severity: "critical", scope: "zone-a", text: "Problem C", pass: 3 },
        { type: "suggestion", severity: "warning", scope: "zone-b", text: "Suggest D", pass: 4 },
      ],
    });
    render(h(SvAnalysisView, { data, onSelect: vi.fn() }), root);

    expect(root.textContent).toContain("4 findings");
    const values = root.querySelectorAll(".stat-card .value");
    expect(values.length).toBe(4);
    expect(values[0]?.textContent).toBe("2"); // patterns & relationships
    expect(values[1]?.textContent).toBe("1"); // anti-patterns
    expect(values[2]?.textContent).toBe("1"); // suggestions
  });

  it("renders category pills", () => {
    const data = makeData({ enrichmentPass: 5 });
    render(h(SvAnalysisView, { data, onSelect: vi.fn() }), root);

    const pills = root.querySelectorAll(".analysis-pill");
    expect(pills.length).toBeGreaterThanOrEqual(5); // All + 4 categories
    expect(pills[0]?.textContent).toContain("All");
  });

  it("renders severity filter pills", () => {
    const data = makeData({ enrichmentPass: 5 });
    render(h(SvAnalysisView, { data, onSelect: vi.fn() }), root);

    expect(root.textContent).toContain("Severity:");
    const sevPills = root.querySelectorAll(".analysis-severity-pill");
    expect(sevPills.length).toBe(4); // All, Critical, Warning, Info
  });

  it("renders move-file findings as distinct cards", () => {
    const data = makeData({
      enrichmentPass: 5,
      findings: [
        {
          type: "move-file" as any,
          severity: "warning",
          scope: "zone-a",
          text: "This file belongs in zone-b",
          pass: 2,
          from: "src/utils/helper.ts",
          to: "src/core/helper.ts",
        },
      ],
    });
    render(h(SvAnalysisView, { data, onSelect: vi.fn() }), root);

    expect(root.querySelector(".move-file-card")).not.toBeNull();
    expect(root.textContent).toContain("Move File Recommendations");
    expect(root.textContent).toContain("src/utils/helper.ts");
    expect(root.textContent).toContain("src/core/helper.ts");
    expect(root.textContent).toContain("This file belongs in zone-b");
  });

  it("handles null zones gracefully", () => {
    const data: LoadedData = {
      manifest: null,
      inventory: null,
      imports: null,
      zones: null,
      components: null,
      callGraph: null,
      classifications: null,
    };
    render(h(SvAnalysisView, { data, onSelect: vi.fn() }), root);

    expect(root.textContent).toContain("Analysis");
    expect(root.textContent).toContain("0 findings");
  });

  it("locks category pills when enrichment pass is below category threshold", () => {
    const data = makeData({ enrichmentPass: 1 });
    render(h(SvAnalysisView, { data, onSelect: vi.fn() }), root);

    const lockedPills = root.querySelectorAll(".analysis-pill-locked");
    expect(lockedPills.length).toBeGreaterThan(0);
  });
});
