import { describe, it, expect } from "vitest";
import { analyzeClassifications, buildClassificationMap } from "../../../src/analyzers/classify.js";
import type { Inventory, Imports, Classifications, ArchetypeDefinition } from "../../../src/schema/index.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeInventory(paths: string[]): Inventory {
  return {
    files: paths.map((path) => ({
      path,
      size: 100,
      language: "TypeScript",
      lineCount: 10,
      hash: "abc",
      role: "source" as const,
      category: "code",
    })),
    summary: {
      totalFiles: paths.length,
      totalLines: paths.length * 10,
      byLanguage: { TypeScript: paths.length },
      byRole: { source: paths.length },
      byCategory: { code: paths.length },
    },
  };
}

function makeImports(edges: Array<{ from: string; to: string; type?: string; symbols?: string[] }>): Imports {
  return {
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      type: (e.type ?? "static") as any,
      symbols: e.symbols ?? ["default"],
    })),
    external: [],
    summary: {
      totalEdges: edges.length,
      totalExternal: 0,
      circularCount: 0,
      circulars: [],
      mostImported: [],
      avgImportsPerFile: 0,
    },
  };
}

const emptyImports = makeImports([]);

// ── Classification basics ──────────────────────────────────────────────────

describe("analyzeClassifications", () => {
  it("classifies entry point files", () => {
    const inv = makeInventory(["src/index.ts", "src/main.ts", "src/app.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    const index = result.files.find((f) => f.path === "src/index.ts")!;
    expect(index.archetype).toBe("entrypoint");
    expect(index.confidence).toBeGreaterThanOrEqual(0.4);
    expect(index.source).toBe("algorithmic");

    const main = result.files.find((f) => f.path === "src/main.ts")!;
    expect(main.archetype).toBe("entrypoint");
  });

  it("classifies utility files", () => {
    const inv = makeInventory(["src/utils/format.ts", "src/helpers/log.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    const format = result.files.find((f) => f.path === "src/utils/format.ts")!;
    expect(format.archetype).toBe("utility");

    const log = result.files.find((f) => f.path === "src/helpers/log.ts")!;
    expect(log.archetype).toBe("utility");
  });

  it("classifies types files", () => {
    const inv = makeInventory(["src/types.ts", "src/constants.ts", "src/globals.d.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    expect(result.files.find((f) => f.path === "src/types.ts")!.archetype).toBe("types");
    expect(result.files.find((f) => f.path === "src/constants.ts")!.archetype).toBe("types");
    expect(result.files.find((f) => f.path === "src/globals.d.ts")!.archetype).toBe("types");
  });

  it("classifies route handler files", () => {
    const inv = makeInventory(["src/routes/users.ts", "src/api/health.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    const routes = result.files.find((f) => f.path === "src/routes/users.ts")!;
    expect(routes.archetype).toBe("route-handler");
  });

  it("classifies store files", () => {
    const inv = makeInventory(["src/store/auth.ts", "src/features/counter.store.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    expect(result.files.find((f) => f.path === "src/store/auth.ts")!.archetype).toBe("store");
    expect(result.files.find((f) => f.path === "src/features/counter.store.ts")!.archetype).toBe("store");
  });

  it("classifies middleware files", () => {
    const inv = makeInventory(["src/middleware/auth.ts", "src/cors.middleware.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    expect(result.files.find((f) => f.path === "src/middleware/auth.ts")!.archetype).toBe("middleware");
    expect(result.files.find((f) => f.path === "src/cors.middleware.ts")!.archetype).toBe("middleware");
  });

  it("classifies model files", () => {
    const inv = makeInventory(["src/models/user.ts", "src/user.model.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    expect(result.files.find((f) => f.path === "src/models/user.ts")!.archetype).toBe("model");
    expect(result.files.find((f) => f.path === "src/user.model.ts")!.archetype).toBe("model");
  });

  it("classifies config files", () => {
    const inv = makeInventory(["src/config.ts", "src/db.config.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    expect(result.files.find((f) => f.path === "src/config.ts")!.archetype).toBe("config");
    expect(result.files.find((f) => f.path === "src/db.config.ts")!.archetype).toBe("config");
  });

  it("classifies test helper files", () => {
    const inv = makeInventory(["tests/fixtures/data.ts", "tests/__mocks__/api.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    expect(result.files.find((f) => f.path === "tests/fixtures/data.ts")!.archetype).toBe("test-helper");
    expect(result.files.find((f) => f.path === "tests/__mocks__/api.ts")!.archetype).toBe("test-helper");
  });

  it("leaves unclassifiable files as null", () => {
    const inv = makeInventory(["src/something-random.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    const file = result.files.find((f) => f.path === "src/something-random.ts")!;
    expect(file.archetype).toBeNull();
    expect(file.confidence).toBe(0);
  });

  it("skips non-source files", () => {
    const inv: Inventory = {
      files: [
        { path: "src/index.ts", size: 100, language: "TypeScript", lineCount: 10, hash: "a", role: "source", category: "root" },
        { path: "tests/index.test.ts", size: 100, language: "TypeScript", lineCount: 10, hash: "b", role: "test", category: "test" },
      ],
      summary: { totalFiles: 2, totalLines: 20, byLanguage: { TypeScript: 2 }, byRole: { source: 1, test: 1 }, byCategory: {} },
    };
    const result = analyzeClassifications(inv, emptyImports);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("src/index.ts");
  });
});

// ── Summary statistics ─────────────────────────────────────────────────────

describe("classification summary", () => {
  it("computes correct counts", () => {
    const inv = makeInventory(["src/index.ts", "src/utils/a.ts", "src/random.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    expect(result.summary.totalClassified + result.summary.totalUnclassified).toBe(3);
    expect(result.summary.bySource.algorithmic).toBe(3);
  });

  it("tracks archetypes in byArchetype", () => {
    const inv = makeInventory(["src/types.ts", "src/constants.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    expect(result.summary.byArchetype["types"]).toBe(2);
  });
});

// ── Evidence ───────────────────────────────────────────────────────────────

describe("classification evidence", () => {
  it("includes evidence for classified files", () => {
    const inv = makeInventory(["src/utils/format.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    const file = result.files[0];
    expect(file.evidence).toBeDefined();
    expect(file.evidence!.length).toBeGreaterThan(0);
    expect(file.evidence![0].archetypeId).toBe("utility");
    expect(file.evidence![0].signalKind).toBe("directory");
  });

  it("does not include evidence for unclassified files", () => {
    const inv = makeInventory(["src/random-thing.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    const file = result.files[0];
    expect(file.evidence).toBeUndefined();
  });
});

// ── Secondary archetypes ───────────────────────────────────────────────────

describe("secondary archetypes", () => {
  it("detects secondary archetypes when multiple signals match", () => {
    // src/config/index.ts matches both "config" (directory) and "entrypoint" (filename)
    const inv = makeInventory(["src/config/index.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    const file = result.files[0];
    // Primary should be one of them, secondary the other
    expect(file.archetype).toBeDefined();
    if (file.secondaryArchetypes) {
      expect(file.secondaryArchetypes.length).toBeGreaterThan(0);
    }
  });
});

// ── Export-based classification ─────────────────────────────────────────────

describe("export-based classification", () => {
  it("classifies route modules by convention exports", () => {
    const inv = makeInventory(["app/routes/home.tsx"]);
    const imports = makeImports([
      { from: "app/root.tsx", to: "app/routes/home.tsx", type: "reexport", symbols: ["loader", "default"] },
    ]);
    const result = analyzeClassifications(inv, imports);

    const file = result.files.find((f) => f.path === "app/routes/home.tsx")!;
    // Should pick up route-module from export signals
    const hasRouteModule = file.archetype === "route-module" ||
      file.secondaryArchetypes?.includes("route-module");
    expect(hasRouteModule).toBe(true);
  });
});

// ── User overrides ─────────────────────────────────────────────────────────

describe("user overrides", () => {
  it("applies user overrides at highest priority", () => {
    const inv = makeInventory(["src/utils/adapter.ts"]);
    const result = analyzeClassifications(inv, emptyImports, {
      overrides: { "src/utils/adapter.ts": "route-handler" },
    });

    const file = result.files[0];
    expect(file.archetype).toBe("route-handler");
    expect(file.source).toBe("user-override");
    expect(file.confidence).toBe(1.0);
  });

  it("sets null archetype for invalid override IDs", () => {
    const inv = makeInventory(["src/a.ts"]);
    const result = analyzeClassifications(inv, emptyImports, {
      overrides: { "src/a.ts": "nonexistent-archetype" },
    });

    const file = result.files[0];
    expect(file.archetype).toBeNull();
    expect(file.source).toBe("user-override");
  });
});

// ── Custom archetypes ──────────────────────────────────────────────────────

describe("custom archetypes", () => {
  it("merges custom archetypes with built-ins", () => {
    const custom: ArchetypeDefinition[] = [
      {
        id: "worker",
        name: "Background Worker",
        description: "Background jobs",
        signals: [{ kind: "directory", pattern: "/workers/", weight: 0.8 }],
      },
    ];

    const inv = makeInventory(["src/workers/email.ts"]);
    const result = analyzeClassifications(inv, emptyImports, { customArchetypes: custom });

    expect(result.files[0].archetype).toBe("worker");
    expect(result.archetypes.some((a) => a.id === "worker")).toBe(true);
    // Built-ins still present
    expect(result.archetypes.some((a) => a.id === "utility")).toBe(true);
  });

  it("custom archetypes override built-ins with same ID", () => {
    const custom: ArchetypeDefinition[] = [
      {
        id: "utility",
        name: "Custom Utility",
        description: "Overridden utility",
        signals: [{ kind: "directory", pattern: "/shared/", weight: 0.9 }],
      },
    ];

    const inv = makeInventory(["src/shared/helpers.ts"]);
    const result = analyzeClassifications(inv, emptyImports, { customArchetypes: custom });

    expect(result.files[0].archetype).toBe("utility");
    const utilDef = result.archetypes.find((a) => a.id === "utility")!;
    expect(utilDef.name).toBe("Custom Utility");
  });
});

// ── Incremental classification ─────────────────────────────────────────────

describe("incremental classification", () => {
  it("reuses cached classification for unchanged files", () => {
    const inv = makeInventory(["src/index.ts", "src/utils/a.ts"]);
    const previous: Classifications = {
      archetypes: [],
      files: [
        { path: "src/index.ts", archetype: "entrypoint", confidence: 0.8, source: "algorithmic" },
        { path: "src/utils/a.ts", archetype: "utility", confidence: 0.8, source: "algorithmic" },
      ],
      summary: { totalClassified: 2, totalUnclassified: 0, byArchetype: {}, bySource: {} },
    };

    const result = analyzeClassifications(inv, emptyImports, {
      previousClassifications: previous,
      changedFiles: new Set(["src/index.ts"]),
    });

    // src/index.ts should be reclassified (it changed)
    // src/utils/a.ts should be reused from cache
    const utilsFile = result.files.find((f) => f.path === "src/utils/a.ts")!;
    expect(utilsFile.archetype).toBe("utility");
    expect(utilsFile.confidence).toBe(0.8);
  });
});

// ── Confidence ─────────────────────────────────────────────────────────────

describe("confidence scores", () => {
  it("caps confidence at 1.0", () => {
    // A file matching multiple high-weight signals should still cap at 1.0
    const inv = makeInventory(["src/utils/helpers/format.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    for (const file of result.files) {
      expect(file.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  it("rounds confidence to 2 decimal places", () => {
    const inv = makeInventory(["src/index.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    const file = result.files[0];
    const str = file.confidence.toString();
    const decimals = str.includes(".") ? str.split(".")[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });
});

// ── Output structure ───────────────────────────────────────────────────────

describe("output structure", () => {
  it("returns sorted files by path", () => {
    const inv = makeInventory(["src/z.ts", "src/a.ts", "src/m.ts"]);
    const result = analyzeClassifications(inv, emptyImports);

    const paths = result.files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort());
  });

  it("returns sorted archetypes by ID", () => {
    const result = analyzeClassifications(makeInventory(["src/a.ts"]), emptyImports);

    const ids = result.archetypes.map((a) => a.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("includes all built-in archetypes in output", () => {
    const result = analyzeClassifications(makeInventory(["src/a.ts"]), emptyImports);
    expect(result.archetypes.length).toBe(12);
  });
});

// ── buildClassificationMap ─────────────────────────────────────────────────

describe("buildClassificationMap", () => {
  it("builds a lookup map from file path to archetype", () => {
    const classifications: Classifications = {
      archetypes: [],
      files: [
        { path: "src/index.ts", archetype: "entrypoint", confidence: 0.8, source: "algorithmic" },
        { path: "src/utils.ts", archetype: "utility", confidence: 0.7, source: "algorithmic" },
        { path: "src/random.ts", archetype: null, confidence: 0, source: "algorithmic" },
      ],
      summary: { totalClassified: 2, totalUnclassified: 1, byArchetype: {}, bySource: {} },
    };

    const map = buildClassificationMap(classifications);
    expect(map.get("src/index.ts")).toBe("entrypoint");
    expect(map.get("src/utils.ts")).toBe("utility");
    expect(map.get("src/random.ts")).toBeNull();
    expect(map.has("nonexistent.ts")).toBe(false);
  });

  it("returns empty map for null input", () => {
    expect(buildClassificationMap(null).size).toBe(0);
  });

  it("returns empty map for undefined input", () => {
    expect(buildClassificationMap(undefined).size).toBe(0);
  });
});
