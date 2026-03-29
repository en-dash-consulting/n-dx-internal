import { describe, it, expect } from "vitest";
import { generateContext } from "../../src/analyzers/context.js";
import type { Manifest, Inventory, Imports, Zones, Components, Classifications, DetectedFrameworks } from "../../src/schema/index.js";

const manifest: Manifest = {
  schemaVersion: "1.0.0",
  toolVersion: "0.1.0",
  analyzedAt: "2024-01-01T00:00:00Z",
  gitSha: "abc1234",
  gitBranch: "main",
  targetPath: "/projects/my-app",
  modules: {},
};

const inventory: Inventory = {
  files: [
    { path: "src/index.ts", size: 100, language: "TypeScript", lineCount: 10, hash: "a", role: "source", category: "root" },
  ],
  summary: {
    totalFiles: 1,
    totalLines: 10,
    byLanguage: { TypeScript: 1 },
    byRole: { source: 1 },
    byCategory: { root: 1 },
  },
};

const imports: Imports = {
  edges: [],
  external: [],
  summary: {
    totalEdges: 0,
    totalExternal: 0,
    circularCount: 0,
    circulars: [],
    mostImported: [],
    avgImportsPerFile: 0,
  },
};

const zones: Zones = {
  zones: [{
    id: "core",
    name: "Core",
    description: "Core logic",
    files: ["src/index.ts"],
    entryPoints: ["src/index.ts"],
    cohesion: 0.9,
    coupling: 0.1,
  }],
  crossings: [],
  unzoned: [],
  findings: [
    { type: "anti-pattern", pass: 1, scope: "global", text: "No tests found", severity: "warning" },
  ],
};

describe("generateContext", () => {
  it("generates context with XML markers", () => {
    const result = generateContext(manifest, inventory, imports, zones);

    expect(result).toContain("<architecture>");
    expect(result).toContain("</architecture>");
    expect(result).toContain("<zones>");
    expect(result).toContain("</zones>");
    expect(result).toContain("<findings>");
    expect(result).toContain("</findings>");
  });

  it("includes project metadata with description count", () => {
    const result = generateContext(manifest, inventory, imports, zones);

    expect(result).toContain("Project: my-app");
    expect(result).toContain("Git: main @ abc1234");
    expect(result).toContain("Files: 1");
    expect(result).toContain("Zones: 1, Described: 1");
  });

  it("shows correct description count when some zones lack descriptions", () => {
    const mixedZones: Zones = {
      ...zones,
      zones: [
        { id: "core", name: "Core", description: "Core logic", files: ["src/index.ts"], entryPoints: [], cohesion: 0.9, coupling: 0.1 },
        { id: "utils", name: "Utils", description: "", files: ["src/utils.ts"], entryPoints: [], cohesion: 0.8, coupling: 0.2 },
        { id: "api", name: "API", description: "API layer", files: ["src/api.ts"], entryPoints: [], cohesion: 0.7, coupling: 0.3 },
      ],
    };

    const result = generateContext(manifest, inventory, imports, mixedZones);
    expect(result).toContain("Zones: 3, Described: 2");
  });

  it("includes zone data", () => {
    const result = generateContext(manifest, inventory, imports, zones);

    expect(result).toContain("[core] Core");
    expect(result).toContain("coh=0.90");
  });

  it("only shows warning and critical findings", () => {
    const zonesWithFindings: Zones = {
      ...zones,
      findings: [
        { type: "observation", pass: 1, scope: "global", text: "Info finding", severity: "info" },
        { type: "anti-pattern", pass: 1, scope: "global", text: "Warning finding", severity: "warning" },
        { type: "anti-pattern", pass: 1, scope: "global", text: "Critical finding", severity: "critical" },
      ],
    };

    const result = generateContext(manifest, inventory, imports, zonesWithFindings);

    expect(result).not.toContain("Info finding");
    expect(result).toContain("Warning finding");
    expect(result).toContain("Critical finding");
  });

  it("includes routes section when components provided", () => {
    const components: Components = {
      components: [],
      usageEdges: [],
      routeModules: [
        { file: "routes/_index.tsx", routePattern: "/", exports: ["default"], parentLayout: null, isLayout: false, isIndex: true },
      ],
      routeTree: [
        { file: "routes/_index.tsx", routePattern: "/", children: [] },
      ],
      serverRoutes: [],
      summary: {
        totalComponents: 0,
        totalRouteModules: 1,
        totalServerRoutes: 0,
        totalUsageEdges: 0,
        routeConventions: { default: 1 },
        mostUsedComponents: [],
        layoutDepth: 1,
      },
    };

    const result = generateContext(manifest, inventory, imports, zones, components);
    expect(result).toContain("<routes>");
    expect(result).toContain("</routes>");
    expect(result).toContain("Route modules: 1");
  });

  it("excludes low-priority next steps from context output", () => {
    const zonesWithFindings: Zones = {
      ...zones,
      findings: [
        // Warning anti-pattern → medium priority next step
        { type: "anti-pattern", pass: 1, scope: "core", text: "Medium priority issue", severity: "warning" },
        // Info suggestion → low priority next step (should be excluded)
        { type: "suggestion", pass: 1, scope: "core", text: "Low priority suggestion", severity: "info" },
      ],
    };

    const result = generateContext(manifest, inventory, imports, zonesWithFindings);

    // Medium priority step should be present
    expect(result).toContain("Medium priority issue");
    // Low priority step should be excluded from CONTEXT.md next-steps
    // (the finding may appear in <findings> but not in <next-steps>)
    const nextStepsSection = result.slice(
      result.indexOf("<next-steps>"),
      result.indexOf("</next-steps>")
    );
    expect(nextStepsSection).not.toContain("Low priority suggestion");
  });

  it("instructs LLM to group related and separate unrelated", () => {
    const result = generateContext(manifest, inventory, imports, zones);
    expect(result).toContain("group related");
    expect(result).toContain("separate unrelated");
  });

  it("stays within reasonable token budget", () => {
    const result = generateContext(manifest, inventory, imports, zones);
    // Rough estimate: ~4 chars per token, 8K token budget = ~32K chars
    expect(result.length).toBeLessThan(32000);
  });

  it("works with null classifications", () => {
    const result = generateContext(manifest, inventory, imports, zones, null, null);
    expect(result).toContain("<zones>");
  });

  it("includes archetype labels when classifications provided", () => {
    const classifications: Classifications = {
      archetypes: [
        { id: "entrypoint", name: "Entry Point", description: "Entry points", signals: [] },
      ],
      files: [
        { path: "src/index.ts", archetype: "entrypoint", confidence: 0.8, source: "algorithmic" },
      ],
      summary: { totalClassified: 1, totalUnclassified: 0, byArchetype: { entrypoint: 1 }, bySource: { algorithmic: 1 } },
    };

    const result = generateContext(manifest, inventory, imports, zones, null, classifications);
    expect(result).toContain("entrypoint");
  });

  it("includes frameworks section when frameworks provided", () => {
    const frameworks: DetectedFrameworks = {
      frameworks: [
        {
          id: "react-router-v7",
          name: "React Router v7 / Remix",
          category: "frontend",
          language: "typescript",
          confidence: 0.95,
          detectedSignals: [
            { kind: "config", pattern: "react-router.config.ts", matchedFiles: ["react-router.config.ts"] },
            { kind: "import", pattern: "react-router", matchedFiles: ["src/entry.tsx"] },
          ],
          projectRoot: ".",
        },
        {
          id: "express",
          name: "Express",
          category: "backend",
          language: "typescript",
          confidence: 0.55,
          detectedSignals: [
            { kind: "import", pattern: "express", matchedFiles: ["src/server.ts"] },
          ],
          projectRoot: "packages/api",
        },
      ],
      roots: [
        { path: ".", detectedFrameworks: [] },
        { path: "packages/api", detectedFrameworks: [] },
      ],
      summary: {
        totalDetected: 2,
        byCategory: { frontend: 1, backend: 1 },
        byLanguage: { typescript: 2 },
      },
    };

    const result = generateContext(manifest, inventory, imports, zones, null, null, frameworks);

    expect(result).toContain("<frameworks>");
    expect(result).toContain("</frameworks>");
    expect(result).toContain("React Router v7 / Remix");
    expect(result).toContain("[frontend]");
    expect(result).toContain("confidence=high(0.95)");
    expect(result).toContain("Express");
    expect(result).toContain("[backend]");
    expect(result).toContain("confidence=medium(0.55)");
    expect(result).toContain("root=packages/api");
    expect(result).toContain("Tier 1 (full)");
    expect(result).toContain("Tier 2 (detect-only)");
  });

  it("omits frameworks section when no frameworks detected", () => {
    const emptyFrameworks: DetectedFrameworks = {
      frameworks: [],
      roots: [{ path: ".", detectedFrameworks: [] }],
      summary: { totalDetected: 0, byCategory: {}, byLanguage: {} },
    };

    const result = generateContext(manifest, inventory, imports, zones, null, null, emptyFrameworks);
    expect(result).not.toContain("<frameworks>");
  });

  it("omits frameworks section when null", () => {
    const result = generateContext(manifest, inventory, imports, zones, null, null, null);
    expect(result).not.toContain("<frameworks>");
  });
});
