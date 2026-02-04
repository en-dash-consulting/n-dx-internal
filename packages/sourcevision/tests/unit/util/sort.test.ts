import { describe, it, expect } from "vitest";
import {
  sortFiles,
  sortEdges,
  sortExternals,
  sortInventory,
  sortImports,
  sortFindings,
  toCanonicalJSON,
} from "../../../src/util/sort.js";
import type { FileEntry, ImportEdge, ExternalImport, Inventory, Imports, Finding } from "../../../src/schema/index.js";

// ── sortFiles ─────────────────────────────────────────────────────────────────

describe("sortFiles", () => {
  it("sorts files by path", () => {
    const files: FileEntry[] = [
      { path: "src/b.ts", size: 10, language: "TypeScript", lineCount: 1, hash: "b", role: "source", category: "src" },
      { path: "a.ts", size: 10, language: "TypeScript", lineCount: 1, hash: "a", role: "source", category: "root" },
      { path: "src/a.ts", size: 10, language: "TypeScript", lineCount: 1, hash: "c", role: "source", category: "src" },
    ];
    const sorted = sortFiles(files);
    expect(sorted.map((f) => f.path)).toEqual(["a.ts", "src/a.ts", "src/b.ts"]);
  });
});

// ── sortEdges ─────────────────────────────────────────────────────────────────

describe("sortEdges", () => {
  it("sorts by from, then to, then type", () => {
    const edges: ImportEdge[] = [
      { from: "b.ts", to: "c.ts", type: "static", symbols: [] },
      { from: "a.ts", to: "c.ts", type: "dynamic", symbols: [] },
      { from: "a.ts", to: "b.ts", type: "static", symbols: [] },
      { from: "a.ts", to: "c.ts", type: "static", symbols: [] },
    ];
    const sorted = sortEdges(edges);
    expect(sorted.map((e) => `${e.from}->${e.to}:${e.type}`)).toEqual([
      "a.ts->b.ts:static",
      "a.ts->c.ts:dynamic",
      "a.ts->c.ts:static",
      "b.ts->c.ts:static",
    ]);
  });
});

// ── sortExternals ─────────────────────────────────────────────────────────────

describe("sortExternals", () => {
  it("sorts by package and inner arrays", () => {
    const externals: ExternalImport[] = [
      { package: "zod", importedBy: ["c.ts", "a.ts"], symbols: ["z", "a"] },
      { package: "axios", importedBy: ["b.ts"], symbols: ["default"] },
    ];
    const sorted = sortExternals(externals);
    expect(sorted[0].package).toBe("axios");
    expect(sorted[1].package).toBe("zod");
    expect(sorted[1].importedBy).toEqual(["a.ts", "c.ts"]);
    expect(sorted[1].symbols).toEqual(["a", "z"]);
  });
});

// ── sortInventory ─────────────────────────────────────────────────────────────

describe("sortInventory", () => {
  it("sorts files within inventory", () => {
    const inv: Inventory = {
      files: [
        { path: "z.ts", size: 1, language: "TypeScript", lineCount: 1, hash: "z", role: "source", category: "root" },
        { path: "a.ts", size: 1, language: "TypeScript", lineCount: 1, hash: "a", role: "source", category: "root" },
      ],
      summary: { totalFiles: 2, totalLines: 2, byLanguage: {}, byRole: {}, byCategory: {} },
    };
    const sorted = sortInventory(inv);
    expect(sorted.files[0].path).toBe("a.ts");
    expect(sorted.files[1].path).toBe("z.ts");
  });
});

// ── sortImports ───────────────────────────────────────────────────────────────

describe("sortImports", () => {
  it("sorts edges, externals, and summary arrays", () => {
    const imp: Imports = {
      edges: [
        { from: "b.ts", to: "a.ts", type: "static", symbols: [] },
        { from: "a.ts", to: "b.ts", type: "static", symbols: [] },
      ],
      external: [
        { package: "zod", importedBy: ["b.ts"], symbols: ["z"] },
        { package: "axios", importedBy: ["a.ts"], symbols: ["default"] },
      ],
      summary: {
        totalEdges: 2,
        totalExternal: 2,
        circularCount: 0,
        circulars: [],
        mostImported: [
          { path: "b.ts", count: 1 },
          { path: "a.ts", count: 1 },
        ],
        avgImportsPerFile: 1,
      },
    };
    const sorted = sortImports(imp);
    expect(sorted.edges[0].from).toBe("a.ts");
    expect(sorted.external[0].package).toBe("axios");
  });
});

// ── sortFindings ─────────────────────────────────────────────────────────────

describe("sortFindings", () => {
  it("sorts by pass first", () => {
    const findings: Finding[] = [
      { type: "observation", pass: 2, scope: "global", text: "b" },
      { type: "observation", pass: 0, scope: "global", text: "a" },
      { type: "observation", pass: 1, scope: "global", text: "c" },
    ];
    const sorted = sortFindings(findings);
    expect(sorted.map((f) => f.pass)).toEqual([0, 1, 2]);
  });

  it("sorts by type within same pass", () => {
    const findings: Finding[] = [
      { type: "suggestion", pass: 1, scope: "global", text: "a" },
      { type: "observation", pass: 1, scope: "global", text: "b" },
      { type: "pattern", pass: 1, scope: "global", text: "c" },
      { type: "anti-pattern", pass: 1, scope: "global", text: "d" },
      { type: "relationship", pass: 1, scope: "global", text: "e" },
    ];
    const sorted = sortFindings(findings);
    expect(sorted.map((f) => f.type)).toEqual([
      "observation",
      "pattern",
      "relationship",
      "anti-pattern",
      "suggestion",
    ]);
  });

  it("sorts by scope then text within same pass and type", () => {
    const findings: Finding[] = [
      { type: "observation", pass: 0, scope: "zone-b", text: "x" },
      { type: "observation", pass: 0, scope: "global", text: "y" },
      { type: "observation", pass: 0, scope: "global", text: "a" },
      { type: "observation", pass: 0, scope: "zone-a", text: "z" },
    ];
    const sorted = sortFindings(findings);
    expect(sorted.map((f) => `${f.scope}:${f.text}`)).toEqual([
      "global:a",
      "global:y",
      "zone-a:z",
      "zone-b:x",
    ]);
  });

  it("does not mutate original array", () => {
    const findings: Finding[] = [
      { type: "suggestion", pass: 1, scope: "global", text: "b" },
      { type: "observation", pass: 0, scope: "global", text: "a" },
    ];
    const sorted = sortFindings(findings);
    expect(sorted).not.toBe(findings);
    expect(findings[0].type).toBe("suggestion"); // original unchanged
  });
});

// ── toCanonicalJSON ───────────────────────────────────────────────────────────

describe("toCanonicalJSON", () => {
  it("uses 2-space indent and trailing newline", () => {
    const result = toCanonicalJSON({ a: 1 });
    expect(result).toBe('{\n  "a": 1\n}\n');
  });
});
