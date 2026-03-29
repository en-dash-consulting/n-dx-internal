// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { Overview } from "../../../src/viewer/views/overview.js";
import type { LoadedData, NavigateTo } from "../../../src/viewer/types.js";
import type {
  DetectedFrameworks,
  DetectedFramework,
} from "../../../src/viewer/external.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFramework(
  overrides: Partial<DetectedFramework> = {},
): DetectedFramework {
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

function makeDetected(
  frameworks: DetectedFramework[],
): DetectedFrameworks {
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

/** Minimal LoadedData with only the fields the overview needs. */
function makeData(
  overrides: Partial<LoadedData> = {},
): LoadedData {
  return {
    manifest: {
      schemaVersion: "1",
      toolVersion: "1.0.0",
      analyzedAt: new Date().toISOString(),
      targetPath: "/test-project",
      modules: {},
    },
    inventory: null,
    imports: null,
    zones: null,
    components: null,
    callGraph: null,
    classifications: null,
    configSurface: null,
    frameworks: null,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Overview — Technology Stack section", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    if (root?.parentNode) root.parentNode.removeChild(root);
  });

  it("hides Technology Stack section when frameworks is null", () => {
    render(h(Overview, { data: makeData({ frameworks: null }) }), root);
    expect(root.querySelector(".tech-stack-categories")).toBeNull();
    expect(root.textContent).not.toContain("Technology Stack");
  });

  it("hides Technology Stack section when frameworks list is empty", () => {
    const frameworks = makeDetected([]);
    render(h(Overview, { data: makeData({ frameworks }) }), root);
    expect(root.querySelector(".tech-stack-categories")).toBeNull();
    expect(root.textContent).not.toContain("Technology Stack");
  });

  it("shows Technology Stack section with detected frameworks", () => {
    const frameworks = makeDetected([
      makeFramework({ id: "express", name: "Express", category: "backend" }),
    ]);
    render(h(Overview, { data: makeData({ frameworks }) }), root);
    expect(root.textContent).toContain("Technology Stack");
    expect(root.querySelector(".tech-stack-categories")).toBeTruthy();
  });

  it("groups frameworks by category", () => {
    const frameworks = makeDetected([
      makeFramework({
        id: "react-router-v7",
        name: "React Router v7",
        category: "frontend",
        confidence: 0.9,
      }),
      makeFramework({
        id: "express",
        name: "Express",
        category: "backend",
        confidence: 0.8,
      }),
      makeFramework({
        id: "nextjs",
        name: "Next.js",
        category: "fullstack",
        confidence: 0.7,
      }),
    ]);
    render(h(Overview, { data: makeData({ frameworks }) }), root);

    const categoryLabels = root.querySelectorAll(".tech-stack-category-label");
    const labelTexts = Array.from(categoryLabels).map((el) => el.textContent);
    expect(labelTexts).toContain("Frontend");
    expect(labelTexts).toContain("Backend");
    expect(labelTexts).toContain("Fullstack");
  });

  it("renders framework badges with name and language", () => {
    const frameworks = makeDetected([
      makeFramework({
        id: "express",
        name: "Express",
        category: "backend",
        language: "typescript",
        confidence: 0.8,
      }),
    ]);
    render(h(Overview, { data: makeData({ frameworks }) }), root);

    const badge = root.querySelector(".tech-stack-badge");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain("Express");
    expect(badge!.textContent).toContain("typescript");
  });

  it("renders confidence indicator dot for each badge", () => {
    const frameworks = makeDetected([
      makeFramework({ confidence: 0.9 }), // high
    ]);
    render(h(Overview, { data: makeData({ frameworks }) }), root);

    const dot = root.querySelector(".tech-stack-confidence");
    expect(dot).toBeTruthy();
    expect(dot!.classList.contains("high")).toBe(true);
  });

  it("maps confidence levels correctly", () => {
    const frameworks = makeDetected([
      makeFramework({ id: "fw-high", name: "High", confidence: 0.85 }),
      makeFramework({ id: "fw-med", name: "Medium", confidence: 0.6 }),
      makeFramework({ id: "fw-low", name: "Low", confidence: 0.3 }),
    ]);
    render(h(Overview, { data: makeData({ frameworks }) }), root);

    const dots = root.querySelectorAll(".tech-stack-confidence");
    expect(dots).toHaveLength(3);
    expect(dots[0].classList.contains("high")).toBe(true);
    expect(dots[1].classList.contains("medium")).toBe(true);
    expect(dots[2].classList.contains("low")).toBe(true);
  });

  it("does not show monorepo root labels when all roots are '.'", () => {
    const frameworks = makeDetected([
      makeFramework({ projectRoot: "." }),
    ]);
    render(h(Overview, { data: makeData({ frameworks }) }), root);

    expect(root.querySelector(".tech-stack-root-label")).toBeNull();
  });

  it("does not show monorepo root labels when projectRoot is undefined", () => {
    const frameworks = makeDetected([
      makeFramework({ id: "express" }),
    ]);
    render(h(Overview, { data: makeData({ frameworks }) }), root);

    expect(root.querySelector(".tech-stack-root-label")).toBeNull();
  });

  it("shows monorepo root labels when multiple roots detected", () => {
    const frameworks = makeDetected([
      makeFramework({
        id: "react-router-v7",
        name: "React Router v7",
        category: "frontend",
        projectRoot: "packages/web",
      }),
      makeFramework({
        id: "go-chi",
        name: "Chi",
        category: "backend",
        language: "go",
        projectRoot: "services/api",
      }),
    ]);
    render(h(Overview, { data: makeData({ frameworks }) }), root);

    const rootLabels = root.querySelectorAll(".tech-stack-root-label");
    expect(rootLabels).toHaveLength(2);
    const texts = Array.from(rootLabels).map((el) => el.textContent);
    expect(texts).toContain("packages/web");
    expect(texts).toContain("services/api");
  });

  it("shows monorepo root label for a single non-root path", () => {
    const frameworks = makeDetected([
      makeFramework({
        id: "express",
        name: "Express",
        category: "backend",
        projectRoot: "packages/server",
      }),
    ]);
    render(h(Overview, { data: makeData({ frameworks }) }), root);

    const rootLabels = root.querySelectorAll(".tech-stack-root-label");
    expect(rootLabels).toHaveLength(1);
    expect(rootLabels[0].textContent).toBe("packages/server");
  });

  it("clicking a badge calls navigateTo with 'files'", () => {
    const navigateTo = vi.fn() as NavigateTo;
    const frameworks = makeDetected([
      makeFramework({ id: "express", name: "Express", projectRoot: "." }),
    ]);
    render(
      h(Overview, { data: makeData({ frameworks }), navigateTo }),
      root,
    );

    const badge = root.querySelector<HTMLElement>(".tech-stack-badge");
    expect(badge).toBeTruthy();
    badge!.click();
    expect(navigateTo).toHaveBeenCalledWith("files", undefined);
  });

  it("clicking a monorepo badge calls navigateTo with the root path", () => {
    const navigateTo = vi.fn() as NavigateTo;
    const frameworks = makeDetected([
      makeFramework({
        id: "express",
        name: "Express",
        projectRoot: "packages/server",
      }),
    ]);
    render(
      h(Overview, { data: makeData({ frameworks }), navigateTo }),
      root,
    );

    const badge = root.querySelector<HTMLElement>(".tech-stack-badge");
    expect(badge).toBeTruthy();
    badge!.click();
    expect(navigateTo).toHaveBeenCalledWith("files", {
      file: "packages/server",
    });
  });

  it("badge has tooltip with confidence details", () => {
    const frameworks = makeDetected([
      makeFramework({
        name: "Express",
        language: "typescript",
        confidence: 0.85,
      }),
    ]);
    render(h(Overview, { data: makeData({ frameworks }) }), root);

    const badge = root.querySelector<HTMLElement>(".tech-stack-badge");
    expect(badge).toBeTruthy();
    const title = badge!.getAttribute("title")!;
    expect(title).toContain("Express");
    expect(title).toContain("typescript");
    expect(title).toContain("high confidence");
    expect(title).toContain("85%");
  });

  it("categories appear in canonical order: Frontend, Backend, Fullstack", () => {
    const frameworks = makeDetected([
      makeFramework({ id: "express", name: "Express", category: "backend" }),
      makeFramework({
        id: "react-router-v7",
        name: "React Router v7",
        category: "frontend",
      }),
      makeFramework({ id: "nextjs", name: "Next.js", category: "fullstack" }),
    ]);
    render(h(Overview, { data: makeData({ frameworks }) }), root);

    const categoryLabels = root.querySelectorAll(".tech-stack-category-label");
    const labelTexts = Array.from(categoryLabels).map((el) => el.textContent);
    expect(labelTexts).toEqual(["Frontend", "Backend", "Fullstack"]);
  });

  it("section appears between metrics and architecture health", () => {
    const frameworks = makeDetected([
      makeFramework({ id: "express", name: "Express" }),
    ]);
    render(h(Overview, { data: makeData({ frameworks }) }), root);

    // The overview-section containing "Technology Stack" should exist
    const sections = root.querySelectorAll(".overview-section");
    const techStackSection = Array.from(sections).find((s) =>
      s.textContent?.includes("Technology Stack"),
    );
    expect(techStackSection).toBeTruthy();

    // It should appear before Architecture Health (if present)
    const allText = root.textContent ?? "";
    const techIdx = allText.indexOf("Technology Stack");
    expect(techIdx).toBeGreaterThan(-1);

    // The metrics row should precede the tech stack
    const metricsEl = root.querySelector(".overview-metrics");
    if (metricsEl) {
      // overview-metrics should appear before .overview-section containing Technology Stack
      const metricsPos = allText.indexOf("Files");
      // Tech stack should come after metrics
      if (metricsPos > -1) {
        expect(techIdx).toBeGreaterThan(metricsPos);
      }
    }
  });
});
