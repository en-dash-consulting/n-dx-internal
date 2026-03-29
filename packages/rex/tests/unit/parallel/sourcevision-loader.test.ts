import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  loadZones,
  loadImports,
  loadSourcevisionData,
} from "../../../src/parallel/sourcevision-loader.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sv-loader-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeSvFile(fileName: string, content: unknown): void {
  const svDir = join(tmpDir, ".sourcevision");
  mkdirSync(svDir, { recursive: true });
  writeFileSync(join(svDir, fileName), JSON.stringify(content));
}

// ── loadZones ────────────────────────────────────────────────────────────────

describe("loadZones", () => {
  it("loads zones from { zones: [...] } wrapper format", () => {
    writeSvFile("zones.json", {
      zones: [
        { id: "zone-a", files: ["src/a.ts", "src/b.ts"] },
        { id: "zone-b", files: ["src/c.ts"] },
      ],
    });

    const zones = loadZones(tmpDir);

    expect(zones.size).toBe(2);
    expect(zones.get("zone-a")).toEqual(new Set(["src/a.ts", "src/b.ts"]));
    expect(zones.get("zone-b")).toEqual(new Set(["src/c.ts"]));
  });

  it("loads zones from bare array format (forward-compatible)", () => {
    writeSvFile("zones.json", [
      { id: "zone-a", files: ["src/a.ts"] },
    ]);

    const zones = loadZones(tmpDir);

    expect(zones.size).toBe(1);
    expect(zones.get("zone-a")).toEqual(new Set(["src/a.ts"]));
  });

  it("returns empty map when .sourcevision/ does not exist", () => {
    const zones = loadZones(tmpDir);

    expect(zones.size).toBe(0);
  });

  it("returns empty map when zones.json does not exist", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    const zones = loadZones(tmpDir);

    expect(zones.size).toBe(0);
  });

  it("returns empty map for malformed JSON", () => {
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    writeFileSync(join(svDir, "zones.json"), "not valid json{{{");

    const zones = loadZones(tmpDir);

    expect(zones.size).toBe(0);
  });

  it("returns empty map for unexpected top-level shape", () => {
    writeSvFile("zones.json", { unexpected: "shape" });

    const zones = loadZones(tmpDir);

    expect(zones.size).toBe(0);
  });

  it("skips entries missing required fields", () => {
    writeSvFile("zones.json", {
      zones: [
        { id: "valid-zone", files: ["src/a.ts"] },
        { files: ["src/b.ts"] },            // missing id
        { id: "no-files" },                 // missing files
        { id: "bad-files", files: "str" },  // files not array
        { id: 123, files: ["src/c.ts"] },   // id not string
        null,                                // null entry
      ],
    });

    const zones = loadZones(tmpDir);

    expect(zones.size).toBe(1);
    expect(zones.get("valid-zone")).toEqual(new Set(["src/a.ts"]));
  });

  it("ignores extra properties on zone entries", () => {
    writeSvFile("zones.json", {
      zones: [
        {
          id: "zone-a",
          files: ["src/a.ts"],
          name: "Zone A",
          description: "Extra property",
          cohesion: 0.5,
        },
      ],
    });

    const zones = loadZones(tmpDir);

    expect(zones.size).toBe(1);
    expect(zones.get("zone-a")).toEqual(new Set(["src/a.ts"]));
  });
});

// ── loadImports ──────────────────────────────────────────────────────────────

describe("loadImports", () => {
  it("loads edges from { edges: [...] } wrapper format", () => {
    writeSvFile("imports.json", {
      edges: [
        { from: "src/a.ts", to: "src/b.ts", type: "static", symbols: ["foo"] },
        { from: "src/b.ts", to: "src/c.ts", type: "static", symbols: ["bar"] },
      ],
    });

    const imports = loadImports(tmpDir);

    // Bidirectional: a→b and b→a
    expect(imports.get("src/a.ts")).toContain("src/b.ts");
    expect(imports.get("src/b.ts")).toContain("src/a.ts");
    // Bidirectional: b→c and c→b
    expect(imports.get("src/b.ts")).toContain("src/c.ts");
    expect(imports.get("src/c.ts")).toContain("src/b.ts");
  });

  it("loads edges from bare array format (forward-compatible)", () => {
    writeSvFile("imports.json", [
      { from: "src/a.ts", to: "src/b.ts" },
    ]);

    const imports = loadImports(tmpDir);

    expect(imports.get("src/a.ts")).toContain("src/b.ts");
    expect(imports.get("src/b.ts")).toContain("src/a.ts");
  });

  it("returns empty map when .sourcevision/ does not exist", () => {
    const imports = loadImports(tmpDir);

    expect(imports.size).toBe(0);
  });

  it("returns empty map when imports.json does not exist", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    const imports = loadImports(tmpDir);

    expect(imports.size).toBe(0);
  });

  it("returns empty map for malformed JSON", () => {
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    writeFileSync(join(svDir, "imports.json"), "invalid{{json");

    const imports = loadImports(tmpDir);

    expect(imports.size).toBe(0);
  });

  it("returns empty map for unexpected top-level shape", () => {
    writeSvFile("imports.json", { unexpected: "shape" });

    const imports = loadImports(tmpDir);

    expect(imports.size).toBe(0);
  });

  it("skips edges missing required fields", () => {
    writeSvFile("imports.json", {
      edges: [
        { from: "src/a.ts", to: "src/b.ts" },  // valid
        { from: "src/c.ts" },                    // missing to
        { to: "src/d.ts" },                      // missing from
        { from: 123, to: "src/e.ts" },           // from not string
        { from: "src/f.ts", to: 456 },           // to not string
        null,                                     // null entry
      ],
    });

    const imports = loadImports(tmpDir);

    // Only the first valid edge should be loaded
    expect(imports.size).toBe(2); // src/a.ts and src/b.ts
    expect(imports.get("src/a.ts")).toEqual(new Set(["src/b.ts"]));
    expect(imports.get("src/b.ts")).toEqual(new Set(["src/a.ts"]));
  });

  it("creates bidirectional edges for each import", () => {
    writeSvFile("imports.json", {
      edges: [
        { from: "src/a.ts", to: "src/b.ts" },
      ],
    });

    const imports = loadImports(tmpDir);

    // Both directions should exist
    expect(imports.has("src/a.ts")).toBe(true);
    expect(imports.has("src/b.ts")).toBe(true);
    expect(imports.get("src/a.ts")!.has("src/b.ts")).toBe(true);
    expect(imports.get("src/b.ts")!.has("src/a.ts")).toBe(true);
  });

  it("accumulates multiple imports for the same file", () => {
    writeSvFile("imports.json", {
      edges: [
        { from: "src/a.ts", to: "src/b.ts" },
        { from: "src/a.ts", to: "src/c.ts" },
        { from: "src/a.ts", to: "src/d.ts" },
      ],
    });

    const imports = loadImports(tmpDir);

    expect(imports.get("src/a.ts")!.size).toBe(3);
    expect(imports.get("src/a.ts")).toContain("src/b.ts");
    expect(imports.get("src/a.ts")).toContain("src/c.ts");
    expect(imports.get("src/a.ts")).toContain("src/d.ts");
  });

  it("ignores extra properties on edge entries", () => {
    writeSvFile("imports.json", {
      edges: [
        { from: "src/a.ts", to: "src/b.ts", type: "static", symbols: ["x"] },
      ],
    });

    const imports = loadImports(tmpDir);

    expect(imports.get("src/a.ts")).toEqual(new Set(["src/b.ts"]));
  });
});

// ── loadSourcevisionData ─────────────────────────────────────────────────────

describe("loadSourcevisionData", () => {
  it("loads both zones and imports together", () => {
    writeSvFile("zones.json", {
      zones: [{ id: "zone-a", files: ["src/a.ts"] }],
    });
    writeSvFile("imports.json", {
      edges: [{ from: "src/a.ts", to: "src/b.ts" }],
    });

    const { zones, imports } = loadSourcevisionData(tmpDir);

    expect(zones.size).toBe(1);
    expect(imports.size).toBe(2);
  });

  it("returns empty data when .sourcevision/ does not exist", () => {
    const { zones, imports } = loadSourcevisionData(tmpDir);

    expect(zones.size).toBe(0);
    expect(imports.size).toBe(0);
  });

  it("loads zones even if imports.json is missing", () => {
    writeSvFile("zones.json", {
      zones: [{ id: "zone-a", files: ["src/a.ts"] }],
    });

    const { zones, imports } = loadSourcevisionData(tmpDir);

    expect(zones.size).toBe(1);
    expect(imports.size).toBe(0);
  });

  it("loads imports even if zones.json is missing", () => {
    writeSvFile("imports.json", {
      edges: [{ from: "src/a.ts", to: "src/b.ts" }],
    });

    const { zones, imports } = loadSourcevisionData(tmpDir);

    expect(zones.size).toBe(0);
    expect(imports.size).toBe(2);
  });
});
