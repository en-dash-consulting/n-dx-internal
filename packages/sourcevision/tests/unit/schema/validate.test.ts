import { describe, it, expect } from "vitest";
import {
  validateManifest,
  validateInventory,
  validateImports,
  validateZones,
  validateComponents,
  validateModule,
} from "../../../src/schema/validate.js";

describe("validateManifest", () => {
  it("accepts valid manifest", () => {
    const result = validateManifest({
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: "2024-01-01T00:00:00Z",
      targetPath: "/test",
      modules: {},
    });
    expect(result.ok).toBe(true);
  });

  it("rejects manifest missing required fields", () => {
    const result = validateManifest({ schemaVersion: "1.0.0" });
    expect(result.ok).toBe(false);
  });

  it("accepts manifest with optional git fields", () => {
    const result = validateManifest({
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: "2024-01-01T00:00:00Z",
      targetPath: "/test",
      modules: {},
      gitSha: "abc123",
      gitBranch: "main",
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateInventory", () => {
  it("accepts valid inventory", () => {
    const result = validateInventory({
      files: [{
        path: "src/index.ts",
        size: 100,
        language: "TypeScript",
        lineCount: 10,
        hash: "abc",
        role: "source",
        category: "root",
      }],
      summary: {
        totalFiles: 1,
        totalLines: 10,
        byLanguage: { TypeScript: 1 },
        byRole: { source: 1 },
        byCategory: { root: 1 },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects negative file size", () => {
    const result = validateInventory({
      files: [{
        path: "test.ts",
        size: -1,
        language: "TypeScript",
        lineCount: 0,
        hash: "abc",
        role: "source",
        category: "root",
      }],
      summary: { totalFiles: 1, totalLines: 0, byLanguage: {}, byRole: {}, byCategory: {} },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = validateInventory({
      files: [{
        path: "test.ts",
        size: 0,
        language: "TypeScript",
        lineCount: 0,
        hash: "abc",
        role: "invalid",
        category: "root",
      }],
      summary: { totalFiles: 1, totalLines: 0, byLanguage: {}, byRole: {}, byCategory: {} },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts file entry with lastModified", () => {
    const result = validateInventory({
      files: [{
        path: "src/index.ts",
        size: 100,
        language: "TypeScript",
        lineCount: 10,
        hash: "abc",
        role: "source",
        category: "root",
        lastModified: 1700000000000,
      }],
      summary: {
        totalFiles: 1,
        totalLines: 10,
        byLanguage: { TypeScript: 1 },
        byRole: { source: 1 },
        byCategory: { root: 1 },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts file entry without lastModified", () => {
    const result = validateInventory({
      files: [{
        path: "src/index.ts",
        size: 100,
        language: "TypeScript",
        lineCount: 10,
        hash: "abc",
        role: "source",
        category: "root",
      }],
      summary: {
        totalFiles: 1,
        totalLines: 10,
        byLanguage: { TypeScript: 1 },
        byRole: { source: 1 },
        byCategory: { root: 1 },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects negative lastModified", () => {
    const result = validateInventory({
      files: [{
        path: "src/index.ts",
        size: 100,
        language: "TypeScript",
        lineCount: 10,
        hash: "abc",
        role: "source",
        category: "root",
        lastModified: -1,
      }],
      summary: {
        totalFiles: 1,
        totalLines: 10,
        byLanguage: { TypeScript: 1 },
        byRole: { source: 1 },
        byCategory: { root: 1 },
      },
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateImports", () => {
  const validImports = {
    edges: [{
      from: "src/a.ts",
      to: "src/b.ts",
      type: "static",
      symbols: ["default"],
    }],
    external: [{
      package: "react",
      importedBy: ["src/a.ts"],
      symbols: ["useState"],
    }],
    summary: {
      totalEdges: 1,
      totalExternal: 1,
      circularCount: 0,
      circulars: [],
      mostImported: [{ path: "src/b.ts", count: 1 }],
      avgImportsPerFile: 1,
    },
  };

  it("accepts valid imports data", () => {
    const result = validateImports(validImports);
    expect(result.ok).toBe(true);
  });

  it("accepts empty imports", () => {
    const result = validateImports({
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
    });
    expect(result.ok).toBe(true);
  });

  it("rejects invalid import type", () => {
    const result = validateImports({
      ...validImports,
      edges: [{ from: "a.ts", to: "b.ts", type: "invalid", symbols: [] }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts all valid import types", () => {
    const types = ["static", "dynamic", "require", "reexport", "type"];
    for (const type of types) {
      const result = validateImports({
        ...validImports,
        edges: [{ from: "a.ts", to: "b.ts", type, symbols: ["x"] }],
      });
      expect(result.ok).toBe(true);
    }
  });

  it("accepts circular dependencies", () => {
    const result = validateImports({
      ...validImports,
      summary: {
        ...validImports.summary,
        circularCount: 1,
        circulars: [{ cycle: ["a.ts", "b.ts", "a.ts"] }],
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing summary fields", () => {
    const result = validateImports({
      edges: [],
      external: [],
      summary: { totalEdges: 0 },
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateZones", () => {
  const validZones = {
    zones: [{
      id: "core",
      name: "Core",
      description: "Core logic",
      files: ["src/a.ts"],
      entryPoints: ["src/a.ts"],
      cohesion: 0.85,
      coupling: 0.15,
    }],
    crossings: [],
    unzoned: [],
  };

  it("accepts valid zones data", () => {
    const result = validateZones(validZones);
    expect(result.ok).toBe(true);
  });

  it("accepts empty zones", () => {
    const result = validateZones({
      zones: [],
      crossings: [],
      unzoned: [],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts zones with optional fields", () => {
    const result = validateZones({
      ...validZones,
      insights: ["Some insight"],
      findings: [{
        type: "observation",
        pass: 0,
        scope: "core",
        text: "High cohesion",
        severity: "info",
      }],
      enrichmentPass: 2,
      metaEvaluationCount: 1,
      structureHash: "abc123",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects cohesion out of range", () => {
    const result = validateZones({
      ...validZones,
      zones: [{ ...validZones.zones[0], cohesion: 1.5 }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects negative coupling", () => {
    const result = validateZones({
      ...validZones,
      zones: [{ ...validZones.zones[0], coupling: -0.1 }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts zone crossings", () => {
    const result = validateZones({
      ...validZones,
      crossings: [{
        from: "src/a.ts",
        to: "src/b.ts",
        fromZone: "core",
        toZone: "util",
      }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects invalid finding type", () => {
    const result = validateZones({
      ...validZones,
      findings: [{
        type: "invalid",
        pass: 0,
        scope: "core",
        text: "Test",
      }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts all valid finding types", () => {
    const types = ["observation", "pattern", "relationship", "anti-pattern", "suggestion"];
    for (const type of types) {
      const result = validateZones({
        ...validZones,
        findings: [{ type, pass: 0, scope: "core", text: "Test" }],
      });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects missing required zone fields", () => {
    const result = validateZones({
      zones: [{ id: "test", name: "Test" }],
      crossings: [],
      unzoned: [],
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateComponents", () => {
  it("accepts valid components data", () => {
    const result = validateComponents({
      components: [{
        file: "src/Button.tsx",
        name: "Button",
        kind: "function",
        line: 1,
        isDefaultExport: false,
        conventionExports: [],
      }],
      usageEdges: [{
        from: "src/App.tsx",
        to: "src/Button.tsx",
        componentName: "Button",
        usageCount: 3,
      }],
      routeModules: [],
      routeTree: [],
      summary: {
        totalComponents: 1,
        totalRouteModules: 0,
        totalUsageEdges: 1,
        routeConventions: {},
        mostUsedComponents: [{ name: "Button", file: "src/Button.tsx", usageCount: 3 }],
        layoutDepth: 0,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects invalid component kind", () => {
    const result = validateComponents({
      components: [{
        file: "test.tsx",
        name: "X",
        kind: "invalid",
        line: 1,
        isDefaultExport: false,
        conventionExports: [],
      }],
      usageEdges: [],
      routeModules: [],
      routeTree: [],
      summary: {
        totalComponents: 1,
        totalRouteModules: 0,
        totalUsageEdges: 0,
        routeConventions: {},
        mostUsedComponents: [],
        layoutDepth: 0,
      },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts route modules with convention exports", () => {
    const result = validateComponents({
      components: [],
      usageEdges: [],
      routeModules: [{
        file: "app/routes/_index.tsx",
        routePattern: "/",
        exports: ["loader", "default", "meta"],
        parentLayout: null,
        isLayout: false,
        isIndex: true,
      }],
      routeTree: [{
        file: "app/routes/_index.tsx",
        routePattern: "/",
        children: [],
      }],
      summary: {
        totalComponents: 0,
        totalRouteModules: 1,
        totalUsageEdges: 0,
        routeConventions: { loader: 1, default: 1, meta: 1 },
        mostUsedComponents: [],
        layoutDepth: 1,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts nested route tree", () => {
    const result = validateComponents({
      components: [],
      usageEdges: [],
      routeModules: [],
      routeTree: [{
        file: "app/routes/users.tsx",
        routePattern: "/users",
        children: [{
          file: "app/routes/users.$id.tsx",
          routePattern: "/users/:id",
          children: [],
        }],
      }],
      summary: {
        totalComponents: 0,
        totalRouteModules: 0,
        totalUsageEdges: 0,
        routeConventions: {},
        mostUsedComponents: [],
        layoutDepth: 2,
      },
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateModule", () => {
  it("dispatches to correct validator", () => {
    const result = validateModule("manifest", {
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: "2024-01-01T00:00:00Z",
      targetPath: "/test",
      modules: {},
    });
    expect(result.ok).toBe(true);
  });

  it("validates components module", () => {
    const result = validateModule("components", {
      components: [],
      usageEdges: [],
      routeModules: [],
      routeTree: [],
      summary: {
        totalComponents: 0,
        totalRouteModules: 0,
        totalUsageEdges: 0,
        routeConventions: {},
        mostUsedComponents: [],
        layoutDepth: 0,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("returns error for unknown module", () => {
    const result = validateModule("unknown", {});
    expect(result.ok).toBe(false);
  });
});
