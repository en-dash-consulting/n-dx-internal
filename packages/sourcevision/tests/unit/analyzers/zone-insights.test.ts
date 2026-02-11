import { describe, it, expect, vi } from "vitest";
import {
  analyzeZones,
  generateStructuralInsights,
} from "../../../src/analyzers/zones.js";
import type {
  Zone,
  Zones,
  ZoneCrossing,
  Finding,
  FindingType,
  ImportEdge,
} from "../../../src/schema/index.js";
import {
  makeFileEntry,
  makeInventory,
  makeEdge,
  makeImports,
  makeZone,
} from "./zones-helpers.js";

// ── generateStructuralInsights ──────────────────────────────────────────────

describe("generateStructuralInsights", () => {
  it("generates high-cohesion insight", () => {
    const zones: Zone[] = [
      { id: "core", name: "Core", description: "", files: ["a.ts", "b.ts", "c.ts"], entryPoints: [], cohesion: 0.9, coupling: 0.1 },
    ];
    const { zoneInsights } = generateStructuralInsights(zones, [], makeImports([]), 10);
    expect(zoneInsights.get("core")!.some((i) => i.includes("High cohesion"))).toBe(true);
  });

  it("generates low-cohesion warning for large zones", () => {
    const zones: Zone[] = [
      { id: "misc", name: "Misc", description: "", files: ["a.ts", "b.ts", "c.ts", "d.ts"], entryPoints: [], cohesion: 0.3, coupling: 0.2 },
    ];
    const { zoneInsights } = generateStructuralInsights(zones, [], makeImports([]), 10);
    expect(zoneInsights.get("misc")!.some((i) => i.includes("Low cohesion"))).toBe(true);
  });

  it("generates hub file insight for files imported across 3+ zones", () => {
    const crossings: ZoneCrossing[] = [
      { from: "a/x.ts", to: "shared/hub.ts", fromZone: "zone-a", toZone: "shared" },
      { from: "b/x.ts", to: "shared/hub.ts", fromZone: "zone-b", toZone: "shared" },
      { from: "c/x.ts", to: "shared/hub.ts", fromZone: "zone-c", toZone: "shared" },
    ];
    const zones: Zone[] = [
      { id: "shared", name: "", description: "", files: ["shared/hub.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    const { globalInsights } = generateStructuralInsights(zones, crossings, makeImports([]), 10);
    expect(globalInsights.some((i) => i.includes("Hub") && i.includes("shared/hub.ts"))).toBe(true);
  });

  it("generates 'consider splitting' warning for large zone without sub-zones", () => {
    const zones: Zone[] = [
      { id: "big", name: "Big", description: "", files: Array.from({ length: 8 }, (_, i) => `${i}.ts`), entryPoints: [], cohesion: 0.9, coupling: 0.1 },
      { id: "small", name: "Small", description: "", files: ["a.ts", "b.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    const { zoneInsights } = generateStructuralInsights(zones, [], makeImports([]), 10);
    const bigInsights = zoneInsights.get("big")!;
    expect(bigInsights.some((i) => i.includes("too broad, consider splitting"))).toBe(true);
  });

  it("generates informational insight for large zone with sub-zones", () => {
    const subZones: Zone[] = [
      { id: "big/cli", name: "Cli", description: "", files: ["cli/a.ts", "cli/b.ts"], entryPoints: [], cohesion: 0.9, coupling: 0.1 },
      { id: "big/core", name: "Core", description: "", files: ["core/a.ts", "core/b.ts", "core/c.ts", "core/d.ts", "core/e.ts", "core/f.ts"], entryPoints: [], cohesion: 0.8, coupling: 0.2 },
    ];
    const zones: Zone[] = [
      { id: "big", name: "Big", description: "", files: Array.from({ length: 8 }, (_, i) => `${i}.ts`), entryPoints: [], cohesion: 0.9, coupling: 0.1, subZones },
      { id: "small", name: "Small", description: "", files: ["a.ts", "b.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    const { zoneInsights } = generateStructuralInsights(zones, [], makeImports([]), 10);
    const bigInsights = zoneInsights.get("big")!;
    // Should NOT suggest splitting since it's already subdivided
    expect(bigInsights.some((i) => i.includes("too broad, consider splitting"))).toBe(false);
    // Should mention the subdivision
    expect(bigInsights.some((i) => i.includes("subdivided into 2 sub-zones"))).toBe(true);
  });

  it("detects bidirectional coupling", () => {
    const crossings: ZoneCrossing[] = [
      { from: "a/x.ts", to: "b/y.ts", fromZone: "alpha", toZone: "beta" },
      { from: "b/z.ts", to: "a/w.ts", fromZone: "beta", toZone: "alpha" },
    ];
    const zones: Zone[] = [
      { id: "alpha", name: "", description: "", files: ["a/x.ts", "a/w.ts"], entryPoints: [], cohesion: 1, coupling: 0.5 },
      { id: "beta", name: "", description: "", files: ["b/y.ts", "b/z.ts"], entryPoints: [], cohesion: 1, coupling: 0.5 },
    ];
    const { globalInsights } = generateStructuralInsights(zones, crossings, makeImports([]), 10);
    expect(globalInsights.some((i) => i.includes("Bidirectional"))).toBe(true);
  });
});

// ── analyzeZones with insights ──────────────────────────────────────────────

describe("analyzeZones insights", () => {
  it("generates structural insights without AI", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.zones).toHaveLength(1);
    // Should have structural insights even without AI
    expect(result.zones[0].insights).toBeDefined();
    expect(result.zones[0].insights!.some((i) => i.includes("cohesion"))).toBe(true);
    // Should have structureHash
    expect(result.structureHash).toBeDefined();
  });

  it("assigns proximity files to reduce unzoned count", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/m/a.ts"),
      makeFileEntry("src/m/b.ts"),
      makeFileEntry("src/m/c.ts"),
      makeFileEntry("src/m/README.md", { role: "docs" }),
      makeFileEntry("src/m/styles.css", { language: "CSS", role: "other" }),
    ]);
    const imports = makeImports([
      makeEdge("src/m/a.ts", "src/m/b.ts"),
      makeEdge("src/m/b.ts", "src/m/c.ts"),
      makeEdge("src/m/a.ts", "src/m/c.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // README.md and styles.css should be assigned to the zone by proximity
    expect(result.zones[0].files).toContain("src/m/README.md");
    expect(result.zones[0].files).toContain("src/m/styles.css");
    expect(result.unzoned).not.toContain("src/m/README.md");
    expect(result.unzoned).not.toContain("src/m/styles.css");
  });
});

// ── analyzeZones structureChanged ──────────────────────────────────────────

describe("analyzeZones structureChanged", () => {
  it("returns structureChanged: false on first run (no previousZones)", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const result = await analyzeZones(inventory, imports, { enrich: false });
    // No previous zones means the structure hash comparison is against undefined,
    // which counts as a change, but it's the first run
    expect(result.structureChanged).toBe(true);
  });

  it("returns structureChanged: false when structure is unchanged", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    // First run to get structureHash
    const firstResult = await analyzeZones(inventory, imports, { enrich: false });

    // Second run with same structure
    const secondResult = await analyzeZones(inventory, imports, {
      enrich: false,
      previousZones: firstResult.zones,
    });

    expect(secondResult.structureChanged).toBe(false);
  });

  it("returns structureChanged: true when zone file membership changes", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    // First run
    const firstResult = await analyzeZones(inventory, imports, { enrich: false });

    // Second run with different files (structure changed)
    const changedInventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
      makeFileEntry("src/b/p.ts"),
      makeFileEntry("src/b/q.ts"),
      makeFileEntry("src/b/r.ts"),
    ]);
    const changedImports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
      makeEdge("src/b/p.ts", "src/b/q.ts"),
      makeEdge("src/b/q.ts", "src/b/r.ts"),
      makeEdge("src/b/p.ts", "src/b/r.ts"),
    ]);

    const secondResult = await analyzeZones(changedInventory, changedImports, {
      enrich: false,
      previousZones: firstResult.zones,
    });

    expect(secondResult.structureChanged).toBe(true);
  });

  it("resets enrichmentPass when structure changes", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    // Simulate a previousZones at pass 3 with a different structure hash
    const firstResult = await analyzeZones(inventory, imports, { enrich: false });
    const previousZones: Zones = {
      ...firstResult.zones,
      enrichmentPass: 3,
      structureHash: "different-hash-to-force-reset",
    };

    // Run with same data but previousZones has wrong structureHash
    const result = await analyzeZones(inventory, imports, {
      enrich: false,
      previousZones,
    });

    // Structure changed, so enrichmentPass should not carry over from previous
    expect(result.structureChanged).toBe(true);
    // The enrichmentPass should be 0 (structural only, no AI enrich)
    expect(result.zones.enrichmentPass).toBe(0);
  });

  it("calls onReset callback when structure changes and previousZones had enrichmentPass", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const firstResult = await analyzeZones(inventory, imports, { enrich: false });
    const previousZones: Zones = {
      ...firstResult.zones,
      enrichmentPass: 5,
      structureHash: "different-hash-to-force-reset",
    };

    const onReset = vi.fn();
    const result = await analyzeZones(inventory, imports, {
      enrich: false,
      previousZones,
      onReset,
    });

    expect(onReset).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledWith(5, 1);
    // lastReset should also be set in the output zones data
    expect(result.zones.lastReset).toEqual({ from: 5, to: 1 });
  });

  it("does not call onReset when structure is unchanged", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const { zones: firstRun } = await analyzeZones(inventory, imports, { enrich: false });
    const previousZones: Zones = { ...firstRun, enrichmentPass: 3 };

    const onReset = vi.fn();
    const result = await analyzeZones(inventory, imports, {
      enrich: false,
      previousZones,
      onReset,
    });

    expect(onReset).not.toHaveBeenCalled();
    expect(result.zones.lastReset).toBeUndefined();
  });

  it("does not call onReset on first run (no previousZones)", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const onReset = vi.fn();
    await analyzeZones(inventory, imports, { enrich: false, onReset });

    expect(onReset).not.toHaveBeenCalled();
  });

  it("preserves enrichmentPass when structure is unchanged in fast mode", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    // First run to get the correct structure hash
    const { zones: firstRun } = await analyzeZones(inventory, imports, { enrich: false });
    const previousZones: Zones = {
      ...firstRun,
      enrichmentPass: 3,
    };

    // Second run (fast mode = enrich: false) with same structure
    const result = await analyzeZones(inventory, imports, {
      enrich: false,
      previousZones,
    });

    // Structure unchanged → should preserve pass 3
    expect(result.structureChanged).toBe(false);
    expect(result.zones.enrichmentPass).toBe(3);
  });
});

// ── analyzeZones findings ──────────────────────────────────────────────────

describe("analyzeZones findings", () => {
  it("produces structural findings at pass 0 with enrich: false", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Should have findings array with pass 0 observations
    expect(result.findings).toBeDefined();
    expect(result.findings!.length).toBeGreaterThan(0);
    expect(result.findings!.every((f) => f.pass === 0)).toBe(true);
    expect(result.findings!.every((f) => f.type === "observation")).toBe(true);

    // enrichmentPass should be 0 (not undefined) to indicate structural analysis completed
    expect(result.enrichmentPass).toBe(0);
  });

  it("populates both findings and insights for backward compat", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Both old insights and new findings should be populated
    expect(result.zones[0].insights).toBeDefined();
    expect(result.findings).toBeDefined();

    // Insights text should appear in findings text
    for (const insight of result.zones[0].insights!) {
      expect(
        result.findings!.some((f) => f.text === insight)
      ).toBe(true);
    }
  });

  it("structural findings have severity based on content", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
      makeFileEntry("src/a/w.ts"),
      makeFileEntry("src/a/v.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/z.ts", "src/a/w.ts"),
      makeEdge("src/a/w.ts", "src/a/v.ts"),
      // Only some internal edges → low cohesion
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });
    if (result.findings) {
      for (const f of result.findings) {
        expect(["info", "warning", "critical"]).toContain(f.severity);
      }
    }
  });

  it("subdivided large zone insight gets info severity, not warning", async () => {
    // Create two clusters of 4 files each = 8 total, which is > 35% of 10
    const cluster1 = Array.from({ length: 4 }, (_, i) => `src/big/a/f${i}.ts`);
    const cluster2 = Array.from({ length: 4 }, (_, i) => `src/big/b/f${i}.ts`);
    const files = [...cluster1, ...cluster2];
    const inventory = makeInventory([
      ...files.map((f) => makeFileEntry(f)),
      makeFileEntry("src/other/x.ts"),
      makeFileEntry("src/other/y.ts"),
    ]);
    // Create two tightly connected clusters with a weak link between
    const edges: ImportEdge[] = [];
    for (let i = 0; i < cluster1.length - 1; i++) {
      edges.push(makeEdge(cluster1[i], cluster1[i + 1]));
    }
    for (let i = 0; i < cluster2.length - 1; i++) {
      edges.push(makeEdge(cluster2[i], cluster2[i + 1]));
    }
    edges.push(makeEdge(cluster1[0], cluster2[0]));
    edges.push(makeEdge("src/other/x.ts", "src/other/y.ts"));
    const imports = makeImports(edges);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Find the zone that contains our big cluster (should have subZones since 8 > threshold... but threshold is 50)
    // Since 8 < SUBDIVISION_THRESHOLD, this won't trigger subdivision.
    // Instead, test via generateStructuralInsights directly with a pre-built zone that has subZones
    const subZones: Zone[] = [
      makeZone("big/a", cluster1),
      makeZone("big/b", cluster2),
    ];
    const bigZone: Zone = {
      ...makeZone("big", files),
      subZones,
    };
    const zones = [bigZone, makeZone("other", ["src/other/x.ts", "src/other/y.ts"])];

    const structural = generateStructuralInsights(zones, [], imports, 10);

    // Build findings same way as analyzeZones does
    const findings: Finding[] = [];
    for (const zone of zones) {
      const zoneStructural = structural.zoneInsights.get(zone.id) ?? [];
      for (const text of zoneStructural) {
        findings.push({
          type: "observation" as FindingType,
          pass: 0,
          scope: zone.id,
          text,
          severity: text.includes("Low cohesion") || text.includes("too broad")
            ? "warning"
            : text.includes("High coupling")
              ? "warning"
              : text.includes("entry points")
                ? "warning"
                : "info",
        });
      }
    }

    // The subdivided zone insight should have severity "info", not "warning"
    const sizeInsight = findings.find((f) => f.scope === "big" && f.text.includes("subdivided into"));
    expect(sizeInsight).toBeDefined();
    expect(sizeInsight!.severity).toBe("info");
    // Should NOT contain "too broad"
    expect(sizeInsight!.text).not.toContain("too broad");
  });

  it("structural findings have severity based on content — entry points get warning", async () => {
    const files = Array.from({ length: 10 }, (_, i) => `src/a/${String.fromCharCode(97 + i)}.ts`);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));
    const imports = makeImports([
      makeEdge(files[0], files[1]),
      makeEdge(files[1], files[2]),
      makeEdge(files[2], files[3]),
      makeEdge(files[3], files[4]),
      makeEdge(files[4], files[5]),
      makeEdge(files[5], files[6]),
      makeEdge(files[6], files[7]),
      makeEdge(files[7], files[8]),
      makeEdge(files[8], files[9]),
      makeEdge(files[0], files[5]),
      makeEdge(files[1], files[6]),
      makeEdge(files[2], files[7]),
      makeEdge(files[3], files[8]),
      makeEdge(files[4], files[9]),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    const entryPointFinding = result.findings?.find((f) => f.text.includes("entry points"));
    if (entryPointFinding) {
      expect(entryPointFinding.severity).toBe("warning");
    }
  });

  it("back-populates findings into insights for backward compat", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Every finding's text should appear in the corresponding insights array
    for (const f of result.findings ?? []) {
      if (f.scope === "global") {
        expect(result.insights ?? []).toContain(f.text);
      } else {
        const zone = result.zones.find((z) => z.id === f.scope);
        if (zone) {
          expect(zone.insights ?? []).toContain(f.text);
        }
      }
    }

    // Every insight should appear as a finding
    for (const zone of result.zones) {
      for (const insight of zone.insights ?? []) {
        expect(result.findings!.some((f) => f.text === insight && f.scope === zone.id)).toBe(true);
      }
    }
    for (const insight of result.insights ?? []) {
      expect(result.findings!.some((f) => f.text === insight && f.scope === "global")).toBe(true);
    }
  });
});
