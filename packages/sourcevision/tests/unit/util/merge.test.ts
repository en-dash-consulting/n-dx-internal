import { describe, it, expect } from "vitest";
import {
  mergeInventories,
  mergeImports,
  detectCirculars,
  chunkByTopDir,
} from "../../../src/util/merge.js";
import type { Inventory, Imports, ImportEdge } from "../../../src/schema/index.js";

// ── mergeInventories ──────────────────────────────────────────────────────────

describe("mergeInventories", () => {
  it("deduplicates by path (last wins) and recomputes summary", () => {
    const chunk1: Inventory = {
      files: [
        { path: "a.ts", size: 10, language: "TypeScript", lineCount: 5, hash: "old", role: "source", category: "root" },
        { path: "b.ts", size: 20, language: "TypeScript", lineCount: 10, hash: "b", role: "source", category: "root" },
      ],
      summary: { totalFiles: 2, totalLines: 15, byLanguage: {}, byRole: {}, byCategory: {} },
    };
    const chunk2: Inventory = {
      files: [
        { path: "a.ts", size: 15, language: "TypeScript", lineCount: 7, hash: "new", role: "source", category: "root" },
      ],
      summary: { totalFiles: 1, totalLines: 7, byLanguage: {}, byRole: {}, byCategory: {} },
    };

    const merged = mergeInventories([chunk1, chunk2]);

    expect(merged.files).toHaveLength(2);
    const fileA = merged.files.find((f) => f.path === "a.ts");
    expect(fileA!.hash).toBe("new"); // last wins
    expect(merged.summary.totalFiles).toBe(2);
    expect(merged.summary.totalLines).toBe(17); // 7 + 10
  });
});

// ── mergeImports ──────────────────────────────────────────────────────────────

describe("mergeImports", () => {
  it("deduplicates edges and merges externals", () => {
    const chunk1: Imports = {
      edges: [
        { from: "a.ts", to: "b.ts", type: "static", symbols: ["foo"] },
      ],
      external: [
        { package: "lodash", importedBy: ["a.ts"], symbols: ["default"] },
      ],
      summary: {
        totalEdges: 1, totalExternal: 1, circularCount: 0,
        circulars: [], mostImported: [], avgImportsPerFile: 1,
      },
    };
    const chunk2: Imports = {
      edges: [
        { from: "a.ts", to: "b.ts", type: "static", symbols: ["bar"] },
        { from: "b.ts", to: "c.ts", type: "static", symbols: ["baz"] },
      ],
      external: [
        { package: "lodash", importedBy: ["b.ts"], symbols: ["get"] },
      ],
      summary: {
        totalEdges: 2, totalExternal: 1, circularCount: 0,
        circulars: [], mostImported: [], avgImportsPerFile: 1,
      },
    };

    const merged = mergeImports([chunk1, chunk2]);

    // a→b deduped (symbols merged), b→c added
    expect(merged.edges).toHaveLength(2);
    const ab = merged.edges.find((e) => e.from === "a.ts" && e.to === "b.ts");
    expect(ab!.symbols).toContain("foo");
    expect(ab!.symbols).toContain("bar");

    // Externals merged
    expect(merged.external).toHaveLength(1);
    expect(merged.external[0].importedBy).toContain("a.ts");
    expect(merged.external[0].importedBy).toContain("b.ts");

    // Summary recomputed
    expect(merged.summary.totalEdges).toBe(2);
  });
});

// ── detectCirculars ───────────────────────────────────────────────────────────

describe("detectCirculars", () => {
  it("returns empty for no cycles", () => {
    const edges: ImportEdge[] = [
      { from: "a.ts", to: "b.ts", type: "static", symbols: [] },
      { from: "b.ts", to: "c.ts", type: "static", symbols: [] },
    ];
    expect(detectCirculars(edges)).toEqual([]);
  });

  it("detects simple A→B→A cycle", () => {
    const edges: ImportEdge[] = [
      { from: "a.ts", to: "b.ts", type: "static", symbols: [] },
      { from: "b.ts", to: "a.ts", type: "static", symbols: [] },
    ];
    const cycles = detectCirculars(edges);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    const flat = cycles.flatMap((c) => c.cycle);
    expect(flat).toContain("a.ts");
    expect(flat).toContain("b.ts");
  });

  it("detects triangle cycle", () => {
    const edges: ImportEdge[] = [
      { from: "a.ts", to: "b.ts", type: "static", symbols: [] },
      { from: "b.ts", to: "c.ts", type: "static", symbols: [] },
      { from: "c.ts", to: "a.ts", type: "static", symbols: [] },
    ];
    const cycles = detectCirculars(edges);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
  });

  it("handles disconnected graph with no cycles", () => {
    const edges: ImportEdge[] = [
      { from: "a.ts", to: "b.ts", type: "static", symbols: [] },
      { from: "c.ts", to: "d.ts", type: "static", symbols: [] },
    ];
    expect(detectCirculars(edges)).toEqual([]);
  });
});

// ── chunkByTopDir ─────────────────────────────────────────────────────────────

describe("chunkByTopDir", () => {
  it("groups by first path segment", () => {
    const files = ["src/a.ts", "src/b.ts", "lib/c.ts", "README.md"];
    const chunks = chunkByTopDir(files);

    expect(chunks.get("src")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(chunks.get("lib")).toEqual(["lib/c.ts"]);
  });

  it("puts root files under '.'", () => {
    // A file without a "/" has its first segment = the filename itself
    // Since "README.md".split("/")[0] === "README.md", root files group by filename
    const chunks = chunkByTopDir(["README.md", "package.json"]);
    expect(chunks.has("README.md")).toBe(true);
    expect(chunks.has("package.json")).toBe(true);
  });
});
