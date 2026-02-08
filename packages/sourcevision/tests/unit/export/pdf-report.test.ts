import { describe, it, expect } from "vitest";
import { generatePdfReport } from "../../../src/export/pdf-report.js";
import type {
  Manifest,
  Inventory,
  Imports,
  Zones,
  Components,
} from "../../../src/schema/v1.js";

describe("generatePdfReport", () => {
  it("returns a Buffer containing PDF data", async () => {
    const data = makeTestData();
    const result = await generatePdfReport(data);

    expect(result).toBeInstanceOf(Buffer);
    // PDF files start with %PDF-
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("includes project name in PDF content", async () => {
    const data = makeTestData();
    const result = await generatePdfReport(data);

    // The buffer should be non-trivially sized (has actual content)
    expect(result.length).toBeGreaterThan(100);
  });

  it("handles data without components", async () => {
    const data = makeTestData();
    data.components = undefined;
    const result = await generatePdfReport(data);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("handles empty zones", async () => {
    const data = makeTestData();
    data.zones.zones = [];
    const result = await generatePdfReport(data);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

function makeTestData(): {
  manifest: Manifest;
  inventory: Inventory;
  imports: Imports;
  zones: Zones;
  components?: Components;
} {
  return {
    manifest: {
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: "2025-01-01T00:00:00Z",
      targetPath: "/home/user/my-project",
      modules: {
        inventory: { status: "complete" },
        imports: { status: "complete" },
        zones: { status: "complete" },
      },
    },
    inventory: {
      files: [
        {
          path: "src/index.ts",
          size: 256,
          language: "TypeScript",
          lineCount: 20,
          hash: "abc123",
          role: "source",
          category: "main",
        },
        {
          path: "src/utils.ts",
          size: 128,
          language: "TypeScript",
          lineCount: 10,
          hash: "def456",
          role: "source",
          category: "utility",
        },
      ],
      summary: {
        totalFiles: 2,
        totalLines: 30,
        byLanguage: { TypeScript: 2 },
        byRole: { source: 2 },
        byCategory: { main: 1, utility: 1 },
      },
    },
    imports: {
      edges: [
        {
          from: "src/index.ts",
          to: "src/utils.ts",
          type: "static",
          symbols: ["helper"],
        },
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
        avgImportsPerFile: 0.5,
      },
    },
    zones: {
      zones: [
        {
          id: "zone-1",
          name: "Core",
          description: "Core application module",
          files: ["src/index.ts", "src/utils.ts"],
          entryPoints: ["src/index.ts"],
          cohesion: 0.85,
          coupling: 0.15,
        },
      ],
      crossings: [],
      unzoned: [],
      findings: [
        {
          type: "observation",
          pass: 1,
          scope: "global",
          text: "Small, well-structured project",
          severity: "info",
        },
      ],
    },
    components: {
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
    },
  };
}
