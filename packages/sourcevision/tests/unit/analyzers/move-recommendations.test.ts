import { describe, it, expect } from "vitest";
import {
  detectPinDivergence,
  detectImportNeighborMoves,
  type MoveContext,
} from "../../../src/analyzers/move-recommendations.js";
import { makeZone, makeEdge, makeImports } from "./zones-helpers.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMoveContext(overrides?: Partial<MoveContext>): MoveContext {
  return {
    zones: [],
    crossings: [],
    edges: [],
    zonePins: {},
    ...overrides,
  };
}

// ── Pin divergence ──────────────────────────────────────────────────────────

describe("detectPinDivergence", () => {
  it("emits move-file finding when a pin moves a file to a different zone", () => {
    const zones = [
      makeZone("zone-a", ["src/a/foo.ts", "src/a/bar.ts"]),
      makeZone("zone-b", ["src/b/baz.ts"]),
    ];
    // foo.ts was pinned from zone-a to zone-b
    const pins: Record<string, string> = { "src/a/foo.ts": "zone-b" };

    const findings = detectPinDivergence(
      makeMoveContext({ zones, zonePins: pins })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: "move-file",
      from: "src/a/foo.ts",
      to: "src/b/",
      moveReason: "zone-pin-override",
      severity: "warning",
    });
  });

  it("skips pins where file is already in the target zone directory", () => {
    const zones = [
      makeZone("zone-a", ["src/a/foo.ts"]),
      makeZone("zone-b", ["src/a/bar.ts"]), // zone-b also lives in src/a/
    ];
    const pins: Record<string, string> = { "src/a/foo.ts": "zone-b" };

    const findings = detectPinDivergence(
      makeMoveContext({ zones, zonePins: pins })
    );

    // File is already physically in a directory that zone-b occupies
    expect(findings).toHaveLength(0);
  });

  it("skips pins where target zone has no files to determine directory", () => {
    const zones = [
      makeZone("zone-a", ["src/a/foo.ts"]),
      makeZone("zone-b", []),
    ];
    const pins: Record<string, string> = { "src/a/foo.ts": "zone-b" };

    const findings = detectPinDivergence(
      makeMoveContext({ zones, zonePins: pins })
    );

    expect(findings).toHaveLength(0);
  });

  it("uses the majority directory of the target zone for 'to' path", () => {
    const zones = [
      makeZone("zone-a", ["src/old/file.ts"]),
      makeZone("zone-b", [
        "src/new/x.ts",
        "src/new/y.ts",
        "src/other/z.ts",
      ]),
    ];
    const pins: Record<string, string> = { "src/old/file.ts": "zone-b" };

    const findings = detectPinDivergence(
      makeMoveContext({ zones, zonePins: pins })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].to).toBe("src/new/");
  });

  it("computes predictedImpact from cross-zone edges the move would eliminate", () => {
    const zones = [
      makeZone("zone-a", ["src/a/foo.ts", "src/a/bar.ts"]),
      makeZone("zone-b", ["src/b/baz.ts", "src/b/qux.ts"]),
    ];
    const pins: Record<string, string> = { "src/a/foo.ts": "zone-b" };
    // foo.ts imports from zone-b files (these cross-zone edges would become internal)
    const edges = [
      makeEdge("src/a/foo.ts", "src/b/baz.ts"),
      makeEdge("src/a/foo.ts", "src/b/qux.ts"),
      makeEdge("src/b/baz.ts", "src/a/foo.ts"),
    ];

    const findings = detectPinDivergence(
      makeMoveContext({ zones, zonePins: pins, edges })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].predictedImpact).toBe(3);
  });

  it("handles multiple pins", () => {
    const zones = [
      makeZone("zone-a", ["src/a/one.ts", "src/a/two.ts"]),
      makeZone("zone-b", ["src/b/three.ts"]),
    ];
    const pins: Record<string, string> = {
      "src/a/one.ts": "zone-b",
      "src/a/two.ts": "zone-b",
    };

    const findings = detectPinDivergence(
      makeMoveContext({ zones, zonePins: pins })
    );

    expect(findings).toHaveLength(2);
  });
});

// ── Import neighbor moves ───────────────────────────────────────────────────

describe("detectImportNeighborMoves", () => {
  it("suggests move when >80% of import neighbors are in another directory", () => {
    const zones = [
      makeZone("zone-a", [
        "src/utils/helper.ts",
        "src/core/main.ts",
        "src/core/types.ts",
        "src/core/validator.ts",
      ]),
    ];
    // helper.ts imports 3 files from src/core/ and nothing from src/utils/
    const edges = [
      makeEdge("src/utils/helper.ts", "src/core/main.ts"),
      makeEdge("src/utils/helper.ts", "src/core/types.ts"),
      makeEdge("src/core/validator.ts", "src/utils/helper.ts"),
    ];

    const findings = detectImportNeighborMoves(
      makeMoveContext({ zones, edges })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: "move-file",
      from: "src/utils/helper.ts",
      to: "src/core/",
      moveReason: "import-neighbor-majority",
      severity: "info",
    });
  });

  it("does not suggest move when neighbors are spread across directories", () => {
    const zones = [
      makeZone("zone-a", [
        "src/utils/helper.ts",
        "src/core/a.ts",
        "src/lib/b.ts",
        "src/api/c.ts",
      ]),
    ];
    const edges = [
      makeEdge("src/utils/helper.ts", "src/core/a.ts"),
      makeEdge("src/utils/helper.ts", "src/lib/b.ts"),
      makeEdge("src/utils/helper.ts", "src/api/c.ts"),
    ];

    const findings = detectImportNeighborMoves(
      makeMoveContext({ zones, edges })
    );

    expect(findings).toHaveLength(0);
  });

  it("does not suggest move when file has fewer than 2 neighbors", () => {
    const zones = [
      makeZone("zone-a", ["src/utils/helper.ts", "src/core/a.ts"]),
    ];
    const edges = [makeEdge("src/utils/helper.ts", "src/core/a.ts")];

    const findings = detectImportNeighborMoves(
      makeMoveContext({ zones, edges })
    );

    expect(findings).toHaveLength(0);
  });

  it("does not suggest move when file is already in the majority directory", () => {
    const zones = [
      makeZone("zone-a", [
        "src/core/helper.ts",
        "src/core/main.ts",
        "src/core/types.ts",
      ]),
    ];
    const edges = [
      makeEdge("src/core/helper.ts", "src/core/main.ts"),
      makeEdge("src/core/helper.ts", "src/core/types.ts"),
    ];

    const findings = detectImportNeighborMoves(
      makeMoveContext({ zones, edges })
    );

    expect(findings).toHaveLength(0);
  });

  it("includes predictedImpact as count of cross-directory edges resolved", () => {
    const zones = [
      makeZone("zone-a", [
        "src/utils/helper.ts",
        "src/core/a.ts",
        "src/core/b.ts",
        "src/core/c.ts",
      ]),
    ];
    const edges = [
      makeEdge("src/utils/helper.ts", "src/core/a.ts"),
      makeEdge("src/utils/helper.ts", "src/core/b.ts"),
      makeEdge("src/core/c.ts", "src/utils/helper.ts"),
    ];

    const findings = detectImportNeighborMoves(
      makeMoveContext({ zones, edges })
    );

    expect(findings).toHaveLength(1);
    // All 3 edges cross directories currently; after move, they'd be same-directory
    expect(findings[0].predictedImpact).toBe(3);
  });
});
