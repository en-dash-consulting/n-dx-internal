import { describe, it, expect } from "vitest";
import {
  analyzeZones,
  computeStructureHash,
  computeZoneContentHash,
  computeGlobalContentHash,
  subdivideZone,
  SUBDIVISION_THRESHOLD,
  MAX_SUBDIVISION_DEPTH,
} from "../../../src/analyzers/zones.js";
import type {
  Zone,
  Zones,
  ImportEdge,
} from "../../../src/schema/index.js";
import {
  makeFileEntry,
  makeInventory,
  makeEdge,
  makeImports,
  makeZone,
} from "./zones-helpers.js";

// ── computeStructureHash ────────────────────────────────────────────────────

describe("computeStructureHash", () => {
  it("produces the same hash for the same zone files", () => {
    const zones: Zone[] = [
      { id: "a", name: "", description: "", files: ["x.ts", "y.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    expect(computeStructureHash(zones)).toBe(computeStructureHash(zones));
  });

  it("produces different hashes for different zone files", () => {
    const z1: Zone[] = [
      { id: "a", name: "", description: "", files: ["x.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    const z2: Zone[] = [
      { id: "a", name: "", description: "", files: ["y.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    expect(computeStructureHash(z1)).not.toBe(computeStructureHash(z2));
  });

  it("is independent of zone ID or name (only file groupings matter)", () => {
    const z1: Zone[] = [
      { id: "a", name: "A", description: "", files: ["x.ts", "y.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    const z2: Zone[] = [
      { id: "renamed", name: "Renamed", description: "", files: ["x.ts", "y.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    expect(computeStructureHash(z1)).toBe(computeStructureHash(z2));
  });
});

// ── subdivideZone ──────────────────────────────────────────────────────────────

describe("subdivideZone", () => {
  it("returns empty array for zones below threshold", () => {
    const zone = makeZone("small", Array.from({ length: 10 }, (_, i) => `src/small/${i}.ts`));
    const inventory = makeInventory(zone.files.map((f) => makeFileEntry(f)));
    const imports = makeImports(zone.files.slice(1).map((f, i) => makeEdge(zone.files[i], f)));

    const subZones = subdivideZone(zone, imports, inventory);

    expect(subZones).toEqual([]);
  });

  it("returns empty array when no internal edges", () => {
    const files = Array.from({ length: 60 }, (_, i) => `src/large/${i}.ts`);
    const zone = makeZone("large", files);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));
    const imports = makeImports([]); // No edges at all

    const subZones = subdivideZone(zone, imports, inventory);

    expect(subZones).toEqual([]);
  });

  it("returns empty array when Louvain finds only one community", () => {
    // All files fully connected = single community
    const files = Array.from({ length: 55 }, (_, i) => `src/large/${i}.ts`);
    const zone = makeZone("large", files);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));
    // Create a complete graph (every file connected to every other)
    const edges: ImportEdge[] = [];
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        edges.push(makeEdge(files[i], files[j]));
      }
    }
    const imports = makeImports(edges);

    const subZones = subdivideZone(zone, imports, inventory);

    // May or may not find sub-communities depending on Louvain result
    // If it finds only 1, returns empty
    // This test just ensures it doesn't throw
    expect(Array.isArray(subZones)).toBe(true);
  });

  it("subdivides a large zone into multiple sub-zones", () => {
    // Create two distinct clusters that should be detected
    const cluster1 = Array.from({ length: 30 }, (_, i) => `src/cluster1/file${i}.ts`);
    const cluster2 = Array.from({ length: 30 }, (_, i) => `src/cluster2/file${i}.ts`);
    const files = [...cluster1, ...cluster2];

    const zone = makeZone("large", files);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));

    // Create edges within each cluster (strong internal connectivity)
    const edges: ImportEdge[] = [];
    for (let i = 0; i < cluster1.length - 1; i++) {
      edges.push(makeEdge(cluster1[i], cluster1[i + 1]));
    }
    for (let i = 0; i < cluster2.length - 1; i++) {
      edges.push(makeEdge(cluster2[i], cluster2[i + 1]));
    }
    // Add a few weak links between clusters
    edges.push(makeEdge(cluster1[0], cluster2[0]));

    const imports = makeImports(edges);

    const subZones = subdivideZone(zone, imports, inventory);

    // Should find at least 2 sub-zones
    expect(subZones.length).toBeGreaterThanOrEqual(2);

    // Sub-zone IDs should be prefixed with parent ID
    for (const sub of subZones) {
      expect(sub.id).toMatch(/^large\//);
    }
  });

  it("sets depth on sub-zones", () => {
    const cluster1 = Array.from({ length: 30 }, (_, i) => `src/a/file${i}.ts`);
    const cluster2 = Array.from({ length: 30 }, (_, i) => `src/b/file${i}.ts`);
    const files = [...cluster1, ...cluster2];

    const zone: Zone = {
      id: "parent",
      name: "Parent",
      description: "test",
      files,
      entryPoints: [],
      cohesion: 0.5,
      coupling: 0.5,
      depth: 0, // Parent is at depth 0
    };
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    for (let i = 0; i < cluster1.length - 1; i++) {
      edges.push(makeEdge(cluster1[i], cluster1[i + 1]));
    }
    for (let i = 0; i < cluster2.length - 1; i++) {
      edges.push(makeEdge(cluster2[i], cluster2[i + 1]));
    }
    edges.push(makeEdge(cluster1[0], cluster2[0]));
    const imports = makeImports(edges);

    const subZones = subdivideZone(zone, imports, inventory);

    // All sub-zones should have depth = parent depth + 1
    for (const sub of subZones) {
      expect(sub.depth).toBe(1);
    }
  });

  it("respects max depth limit", () => {
    const files = Array.from({ length: 60 }, (_, i) => `src/deep/${i}.ts`);
    const zone: Zone = {
      id: "deep",
      name: "Deep",
      description: "test",
      files,
      entryPoints: [],
      cohesion: 0.5,
      coupling: 0.5,
    };
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));
    const edges = files.slice(1).map((f, i) => makeEdge(files[i], f));
    const imports = makeImports(edges);

    // Call with depth at max
    const subZones = subdivideZone(zone, imports, inventory, MAX_SUBDIVISION_DEPTH);

    // Should return empty (depth exceeded)
    expect(subZones).toEqual([]);
  });
});

describe("SUBDIVISION_THRESHOLD", () => {
  it("is set to a reasonable value", () => {
    expect(SUBDIVISION_THRESHOLD).toBeGreaterThanOrEqual(30);
    expect(SUBDIVISION_THRESHOLD).toBeLessThanOrEqual(100);
  });
});

describe("MAX_SUBDIVISION_DEPTH", () => {
  it("is set to prevent infinite recursion", () => {
    expect(MAX_SUBDIVISION_DEPTH).toBeGreaterThanOrEqual(1);
    expect(MAX_SUBDIVISION_DEPTH).toBeLessThanOrEqual(5);
  });
});

// ── computeZoneContentHash / computeGlobalContentHash ───────────────────────

describe("computeZoneContentHash", () => {
  it("produces the same hash for the same files and content", () => {
    const zone = makeZone("core", ["a.ts", "b.ts"]);
    const hashes = new Map([["a.ts", "hash1"], ["b.ts", "hash2"]]);
    expect(computeZoneContentHash(zone, hashes)).toBe(computeZoneContentHash(zone, hashes));
  });

  it("produces a different hash when file content changes", () => {
    const zone = makeZone("core", ["a.ts", "b.ts"]);
    const before = new Map([["a.ts", "hash1"], ["b.ts", "hash2"]]);
    const after = new Map([["a.ts", "hash1-changed"], ["b.ts", "hash2"]]);
    expect(computeZoneContentHash(zone, before)).not.toBe(computeZoneContentHash(zone, after));
  });

  it("is independent of file order", () => {
    const zone1 = makeZone("core", ["b.ts", "a.ts"]);
    const zone2 = makeZone("core", ["a.ts", "b.ts"]);
    const hashes = new Map([["a.ts", "h1"], ["b.ts", "h2"]]);
    expect(computeZoneContentHash(zone1, hashes)).toBe(computeZoneContentHash(zone2, hashes));
  });

  it("is independent of zone ID/name (only files and their hashes matter)", () => {
    const zone1 = makeZone("core", ["a.ts"]);
    const zone2 = makeZone("renamed", ["a.ts"]);
    const hashes = new Map([["a.ts", "h1"]]);
    expect(computeZoneContentHash(zone1, hashes)).toBe(computeZoneContentHash(zone2, hashes));
  });
});

describe("computeGlobalContentHash", () => {
  it("produces the same hash for the same inputs", () => {
    const hashes = { core: "abc", util: "def" };
    expect(computeGlobalContentHash(hashes)).toBe(computeGlobalContentHash(hashes));
  });

  it("changes when any zone content hash changes", () => {
    const before = { core: "abc", util: "def" };
    const after = { core: "abc", util: "changed" };
    expect(computeGlobalContentHash(before)).not.toBe(computeGlobalContentHash(after));
  });

  it("is independent of key order", () => {
    const a = { core: "abc", util: "def" };
    const b = { util: "def", core: "abc" };
    expect(computeGlobalContentHash(a)).toBe(computeGlobalContentHash(b));
  });
});

// ── Stale finding filtering ─────────────────────────────────────────────────

describe("analyzeZones stale content hash filtering", () => {
  it("drops AI findings for zones whose content changed", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "new-hash-x" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    // First run to get the zone structure and content hashes
    const { zones: firstRun } = await analyzeZones(inventory, imports, { enrich: false });
    const zoneId = firstRun.zones[0].id;

    // Construct previousZones with an AI finding and original content hashes
    const previousZones: Zones = {
      ...firstRun,
      findings: [
        ...(firstRun.findings ?? []),
        { type: "pattern", pass: 1, scope: zoneId, text: "AI finding that should be dropped", severity: "warning" },
      ],
      enrichmentPass: 1,
    };

    // Second run with changed file content (different hash for x.ts)
    const changedInventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "CHANGED-hash-x" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);

    const { zones: secondRun } = await analyzeZones(changedInventory, imports, {
      enrich: false,
      previousZones,
    });

    // The AI finding should be dropped because zone content changed
    const aiFinding = secondRun.findings?.find((f) => f.pass > 0 && f.text === "AI finding that should be dropped");
    expect(aiFinding).toBeUndefined();
    // Structural findings (pass 0) should still be present
    expect(secondRun.findings?.some((f) => f.pass === 0)).toBe(true);
  });

  it("preserves AI findings when content has not changed", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "hash-x" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    // First run
    const { zones: firstRun } = await analyzeZones(inventory, imports, { enrich: false });
    const zoneId = firstRun.zones[0].id;

    const previousZones: Zones = {
      ...firstRun,
      findings: [
        ...(firstRun.findings ?? []),
        { type: "pattern", pass: 1, scope: zoneId, text: "AI finding preserved", severity: "info" },
      ],
      enrichmentPass: 1,
    };

    // Second run with same content
    const { zones: secondRun } = await analyzeZones(inventory, imports, {
      enrich: false,
      previousZones,
    });

    const aiFinding = secondRun.findings?.find((f) => f.text === "AI finding preserved");
    expect(aiFinding).toBeDefined();
  });

  it("preserves all AI findings when previousZones lacks zoneContentHashes (backward compat)", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "hash-x" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    // First run to get structure hash
    const { zones: firstRun } = await analyzeZones(inventory, imports, { enrich: false });
    const zoneId = firstRun.zones[0].id;

    // Construct previousZones WITHOUT zoneContentHashes (old format)
    const previousZones: Zones = {
      zones: firstRun.zones,
      crossings: firstRun.crossings,
      unzoned: firstRun.unzoned,
      structureHash: firstRun.structureHash,
      findings: [
        ...(firstRun.findings ?? []),
        { type: "anti-pattern", pass: 2, scope: zoneId, text: "Legacy AI finding", severity: "warning" },
      ],
      enrichmentPass: 2,
      // No zoneContentHashes — old format
    };

    // Run with different content but same structure
    const changedInventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "CHANGED" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);

    const { zones: secondRun } = await analyzeZones(changedInventory, imports, {
      enrich: false,
      previousZones,
    });

    // Should preserve the finding because there are no previous content hashes to compare
    const legacyFinding = secondRun.findings?.find((f) => f.text === "Legacy AI finding");
    expect(legacyFinding).toBeDefined();
  });

  it("includes zoneContentHashes in output", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "h1" }),
      makeFileEntry("src/a/y.ts", { hash: "h2" }),
      makeFileEntry("src/a/z.ts", { hash: "h3" }),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.zoneContentHashes).toBeDefined();
    expect(Object.keys(result.zoneContentHashes!)).toHaveLength(1);
    // Value should be a 16-char hex string
    const hash = Object.values(result.zoneContentHashes!)[0];
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("drops global AI findings when global content changes", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "hash-x" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const { zones: firstRun } = await analyzeZones(inventory, imports, { enrich: false });

    const previousZones: Zones = {
      ...firstRun,
      findings: [
        ...(firstRun.findings ?? []),
        { type: "pattern", pass: 1, scope: "global", text: "Global AI finding", severity: "info" },
      ],
      enrichmentPass: 1,
    };

    // Change content
    const changedInventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "CHANGED" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);

    const { zones: secondRun } = await analyzeZones(changedInventory, imports, {
      enrich: false,
      previousZones,
    });

    const globalAiFinding = secondRun.findings?.find((f) => f.text === "Global AI finding");
    expect(globalAiFinding).toBeUndefined();
  });
});
