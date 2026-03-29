import { describe, it, expect } from "vitest";
import { generateLlmsTxt } from "../../src/analyzers/llms-txt.js";
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
    { path: "src/utils.ts", size: 200, language: "TypeScript", lineCount: 20, hash: "b", role: "source", category: "utils" },
  ],
  summary: {
    totalFiles: 2,
    totalLines: 30,
    byLanguage: { TypeScript: 2 },
    byRole: { source: 2 },
    byCategory: { root: 1, utils: 1 },
  },
};

const imports: Imports = {
  edges: [
    { from: "src/index.ts", to: "src/utils.ts", type: "static", symbols: ["formatName"] },
  ],
  external: [
    { package: "zod", importedBy: ["src/index.ts"], symbols: ["z"] },
  ],
  summary: {
    totalEdges: 1,
    totalExternal: 1,
    circularCount: 0,
    circulars: [],
    mostImported: [{ path: "src/utils.ts", count: 1 }],
    avgImportsPerFile: 1,
  },
};

const zones: Zones = {
  zones: [
    {
      id: "core",
      name: "Core",
      description: "Core application logic",
      files: ["src/index.ts", "src/utils.ts"],
      entryPoints: ["src/index.ts"],
      cohesion: 0.8,
      coupling: 0.2,
    },
  ],
  crossings: [],
  unzoned: [],
  findings: [
    { type: "observation", pass: 1, scope: "global", text: "Well-structured project", severity: "info" },
  ],
};

describe("generateLlmsTxt", () => {
  it("generates markdown with all required sections", () => {
    const result = generateLlmsTxt(manifest, inventory, imports, zones);

    expect(result).toContain("# my-app");
    expect(result).toContain("## Project Overview");
    expect(result).toContain("**Files**: 2");
    expect(result).toContain("**Git**: main @ abc1234");
    expect(result).toContain("## Architecture Zones");
    expect(result).toContain("### Core");
    expect(result).toContain("## Key Dependencies");
    expect(result).toContain("`src/utils.ts`");
    expect(result).toContain("`zod`");
    expect(result).toContain("## Findings");
    expect(result).toContain("## File Inventory");
  });

  it("mentions the description count", () => {
    const result = generateLlmsTxt(manifest, inventory, imports, zones);
    expect(result).toContain("**Zones**: 1 (1 with descriptions)");
  });

  it("shows correct description count with mixed zones", () => {
    const mixedZones: Zones = {
      ...zones,
      zones: [
        { id: "core", name: "Core", description: "Core logic", files: ["src/index.ts"], entryPoints: [], cohesion: 0.8, coupling: 0.2 },
        { id: "utils", name: "Utils", description: "", files: ["src/utils.ts"], entryPoints: [], cohesion: 0.7, coupling: 0.3 },
      ],
    };

    const result = generateLlmsTxt(manifest, inventory, imports, mixedZones);
    expect(result).toContain("**Zones**: 2 (1 with descriptions)");
  });

  it("instructs LLM to group related and separate unrelated", () => {
    const result = generateLlmsTxt(manifest, inventory, imports, zones);
    expect(result).toContain("group related");
    expect(result).toContain("separate unrelated");
  });

  it("includes route structure when components provided", () => {
    const components: Components = {
      components: [],
      usageEdges: [],
      routeModules: [
        { file: "app/routes/_index.tsx", routePattern: "/", exports: ["loader", "default"], parentLayout: null, isLayout: false, isIndex: true },
      ],
      routeTree: [
        { file: "app/routes/_index.tsx", routePattern: "/", children: [] },
      ],
      serverRoutes: [],
      summary: {
        totalComponents: 1,
        totalRouteModules: 1,
        totalServerRoutes: 0,
        totalUsageEdges: 0,
        routeConventions: { loader: 1, default: 1 },
        mostUsedComponents: [],
        layoutDepth: 1,
      },
    };

    const result = generateLlmsTxt(manifest, inventory, imports, zones, components);
    expect(result).toContain("## Route Structure");
    expect(result).toContain("### Route Tree");
    expect(result).toContain("### Convention Exports");
  });

  it("omits route section when no components", () => {
    const result = generateLlmsTxt(manifest, inventory, imports, zones, null);
    expect(result).not.toContain("## Route Structure");
  });

  it("works with null classifications", () => {
    const result = generateLlmsTxt(manifest, inventory, imports, zones, null, null);
    expect(result).toContain("## File Inventory");
  });

  it("includes archetype column when classifications provided", () => {
    const classifications: Classifications = {
      archetypes: [
        { id: "entrypoint", name: "Entry Point", description: "Entry points", signals: [] },
        { id: "utility", name: "Utility", description: "Utilities", signals: [] },
      ],
      files: [
        { path: "src/index.ts", archetype: "entrypoint", confidence: 0.8, source: "algorithmic" },
        { path: "src/utils.ts", archetype: "utility", confidence: 0.7, source: "algorithmic" },
      ],
      summary: { totalClassified: 2, totalUnclassified: 0, byArchetype: { entrypoint: 1, utility: 1 }, bySource: { algorithmic: 2 } },
    };

    const result = generateLlmsTxt(manifest, inventory, imports, zones, null, classifications);
    expect(result).toContain("Archetype");
    expect(result).toContain("entrypoint");
    expect(result).toContain("utility");
  });

  it("includes technology stack section when frameworks provided", () => {
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
          id: "go-chi",
          name: "chi",
          category: "backend",
          language: "go",
          confidence: 0.45,
          detectedSignals: [
            { kind: "import", pattern: "github.com/go-chi/chi", matchedFiles: ["cmd/api/main.go"] },
          ],
          projectRoot: "services/api",
        },
      ],
      roots: [
        { path: ".", detectedFrameworks: [] },
        { path: "services/api", detectedFrameworks: [] },
      ],
      summary: {
        totalDetected: 2,
        byCategory: { frontend: 1, backend: 1 },
        byLanguage: { typescript: 1, go: 1 },
      },
    };

    const result = generateLlmsTxt(manifest, inventory, imports, zones, null, null, frameworks);

    expect(result).toContain("## Technology Stack");
    expect(result).toContain("### Detected Frameworks");
    expect(result).toContain("**React Router v7 / Remix**");
    expect(result).toContain("frontend");
    expect(result).toContain("confidence: high (0.95)");
    expect(result).toContain("**chi**");
    expect(result).toContain("confidence: low (0.45)");
    expect(result).toContain("(root: `services/api`)");
    expect(result).toContain("### Supported Languages");
    expect(result).toContain("Tier 1 (full analysis)");
    expect(result).toContain("Tier 2 (detection only)");
  });

  it("includes framework-specific analysis capabilities", () => {
    const frameworks: DetectedFrameworks = {
      frameworks: [
        {
          id: "express",
          name: "Express",
          category: "backend",
          language: "typescript",
          confidence: 0.55,
          detectedSignals: [
            { kind: "import", pattern: "express", matchedFiles: ["src/server.ts"] },
          ],
          projectRoot: ".",
        },
      ],
      roots: [{ path: ".", detectedFrameworks: [] }],
      summary: { totalDetected: 1, byCategory: { backend: 1 }, byLanguage: { typescript: 1 } },
    };

    const result = generateLlmsTxt(manifest, inventory, imports, zones, null, null, frameworks);
    expect(result).toContain("Analysis capabilities: server-route-detection, middleware-chain");
  });

  it("omits technology stack when no frameworks detected", () => {
    const emptyFrameworks: DetectedFrameworks = {
      frameworks: [],
      roots: [{ path: ".", detectedFrameworks: [] }],
      summary: { totalDetected: 0, byCategory: {}, byLanguage: {} },
    };

    const result = generateLlmsTxt(manifest, inventory, imports, zones, null, null, emptyFrameworks);
    expect(result).not.toContain("## Technology Stack");
  });

  it("omits technology stack when frameworks is null", () => {
    const result = generateLlmsTxt(manifest, inventory, imports, zones, null, null, null);
    expect(result).not.toContain("## Technology Stack");
  });
});
