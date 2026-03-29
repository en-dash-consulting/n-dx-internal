import { describe, it, expect } from "vitest";
import type { PRDItem } from "../../../src/schema/v1.js";
import type { ZoneIndex, ImportGraph } from "../../../src/parallel/blast-radius.js";
import {
  buildConflictGraph,
  findIndependentSets,
} from "../../../src/parallel/conflict-analysis.js";
import type {
  ConflictGraph,
  ExecutionPlan,
} from "../../../src/parallel/conflict-analysis.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<PRDItem> = {}): PRDItem {
  return {
    id: "task-1",
    title: "Test Task",
    status: "pending",
    level: "task",
    ...overrides,
  };
}

function makeFeature(
  id: string,
  children: PRDItem[],
  overrides: Partial<PRDItem> = {},
): PRDItem {
  return {
    id,
    title: `Feature ${id}`,
    status: "pending",
    level: "feature",
    children,
    ...overrides,
  };
}

function makeZoneIndex(zones: Record<string, string[]>): ZoneIndex {
  const index: ZoneIndex = new Map();
  for (const [id, files] of Object.entries(zones)) {
    index.set(id, new Set(files));
  }
  return index;
}

function makeImportGraph(edges: Record<string, string[]>): ImportGraph {
  const graph: ImportGraph = new Map();
  for (const [file, neighbors] of Object.entries(edges)) {
    graph.set(file, new Set(neighbors));
  }
  return graph;
}

function makeBlastRadii(
  radii: Record<string, string[]>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [id, files] of Object.entries(radii)) {
    map.set(id, new Set(files));
  }
  return map;
}

/** Get all task IDs in a specific group of the execution plan. */
function getGroupTaskIds(plan: ExecutionPlan, groupIndex: number): string[] {
  const group = plan.groups.find((g) => g.index === groupIndex);
  return group ? group.taskIds : [];
}

/** Check if two task IDs are in the same group. */
function areInSameGroup(plan: ExecutionPlan, idA: string, idB: string): boolean {
  return plan.groups.some(
    (g) => g.taskIds.includes(idA) && g.taskIds.includes(idB),
  );
}

// ── buildConflictGraph ──────────────────────────────────────────────────────

describe("buildConflictGraph", () => {
  it("returns empty adjacency lists for non-overlapping blast radii", () => {
    const radii = makeBlastRadii({
      t1: ["src/a.ts"],
      t2: ["src/b.ts"],
    });

    const graph = buildConflictGraph(radii);

    expect(graph.get("t1")).toEqual([]);
    expect(graph.get("t2")).toEqual([]);
  });

  it("creates high-confidence edges for direct file overlap", () => {
    const radii = makeBlastRadii({
      t1: ["src/shared.ts", "src/a.ts"],
      t2: ["src/shared.ts", "src/b.ts"],
    });

    const graph = buildConflictGraph(radii);

    const t1Edges = graph.get("t1")!;
    expect(t1Edges).toHaveLength(1);
    expect(t1Edges[0].targetId).toBe("t2");
    expect(t1Edges[0].confidence).toBe("high");
    expect(t1Edges[0].weight).toBe(1);
    expect(t1Edges[0].overlappingFiles).toContain("src/shared.ts");
  });

  it("sets edge weight to number of overlapping files", () => {
    const radii = makeBlastRadii({
      t1: ["src/a.ts", "src/b.ts", "src/c.ts"],
      t2: ["src/a.ts", "src/b.ts", "src/d.ts"],
    });

    const graph = buildConflictGraph(radii);

    const t1Edges = graph.get("t1")!;
    expect(t1Edges[0].weight).toBe(2); // src/a.ts and src/b.ts overlap
  });

  it("creates bidirectional edges", () => {
    const radii = makeBlastRadii({
      t1: ["src/shared.ts"],
      t2: ["src/shared.ts"],
    });

    const graph = buildConflictGraph(radii);

    expect(graph.get("t1")!.some((e) => e.targetId === "t2")).toBe(true);
    expect(graph.get("t2")!.some((e) => e.targetId === "t1")).toBe(true);
  });

  it("creates medium-confidence edges for shared import neighborhood", () => {
    const radii = makeBlastRadii({
      t1: ["src/a.ts"],
      t2: ["src/b.ts"],
    });
    const imports = makeImportGraph({
      "src/a.ts": ["src/b.ts"], // a imports b → shared neighborhood
    });

    const graph = buildConflictGraph(radii, imports);

    const t1Edges = graph.get("t1")!;
    expect(t1Edges).toHaveLength(1);
    expect(t1Edges[0].confidence).toBe("medium");
  });

  it("creates low-confidence edges for same-zone proximity", () => {
    const radii = makeBlastRadii({
      t1: ["src/a.ts"],
      t2: ["src/c.ts"], // different file, same zone
    });
    const zones = makeZoneIndex({
      "web-viewer": ["src/a.ts", "src/c.ts"],
    });

    const graph = buildConflictGraph(radii, new Map(), zones);

    const t1Edges = graph.get("t1")!;
    expect(t1Edges).toHaveLength(1);
    expect(t1Edges[0].confidence).toBe("low");
    expect(t1Edges[0].weight).toBe(1);
  });

  it("prefers high over medium confidence when both apply", () => {
    const radii = makeBlastRadii({
      t1: ["src/shared.ts", "src/a.ts"],
      t2: ["src/shared.ts", "src/b.ts"],
    });
    // Also set up import neighbors, but direct overlap takes precedence
    const imports = makeImportGraph({
      "src/a.ts": ["src/b.ts"],
    });

    const graph = buildConflictGraph(radii, imports);

    const t1Edges = graph.get("t1")!;
    expect(t1Edges[0].confidence).toBe("high");
  });

  it("handles tasks with empty blast radii", () => {
    const radii = makeBlastRadii({
      t1: [],
      t2: ["src/a.ts"],
    });

    const graph = buildConflictGraph(radii);

    expect(graph.get("t1")).toEqual([]);
    expect(graph.get("t2")).toEqual([]);
  });

  it("handles single task", () => {
    const radii = makeBlastRadii({
      t1: ["src/a.ts"],
    });

    const graph = buildConflictGraph(radii);

    expect(graph.get("t1")).toEqual([]);
  });

  it("handles empty blast radii map", () => {
    const graph = buildConflictGraph(new Map());

    expect(graph.size).toBe(0);
  });

  it("limits overlapping files sample to 5", () => {
    const sharedFiles = Array.from(
      { length: 10 },
      (_, i) => `src/file${i}.ts`,
    );
    const radii = makeBlastRadii({
      t1: sharedFiles,
      t2: sharedFiles,
    });

    const graph = buildConflictGraph(radii);

    const t1Edges = graph.get("t1")!;
    expect(t1Edges[0].overlappingFiles.length).toBeLessThanOrEqual(5);
    expect(t1Edges[0].weight).toBe(10); // weight reflects full count
  });

  it("creates edges between all overlapping pairs in a 3-task graph", () => {
    const radii = makeBlastRadii({
      t1: ["src/shared.ts"],
      t2: ["src/shared.ts"],
      t3: ["src/shared.ts"],
    });

    const graph = buildConflictGraph(radii);

    // Each task should have edges to the other two
    expect(graph.get("t1")).toHaveLength(2);
    expect(graph.get("t2")).toHaveLength(2);
    expect(graph.get("t3")).toHaveLength(2);
  });
});

// ── findIndependentSets ─────────────────────────────────────────────────────

describe("findIndependentSets", () => {
  it("places non-overlapping tasks in separate groups", () => {
    const radii = makeBlastRadii({
      t1: ["src/a.ts"],
      t2: ["src/b.ts"],
      t3: ["src/c.ts"],
    });
    const graph = buildConflictGraph(radii);
    const items = [
      makeFeature("f1", [
        makeTask({ id: "t1" }),
      ]),
      makeFeature("f2", [
        makeTask({ id: "t2" }),
      ]),
      makeFeature("f3", [
        makeTask({ id: "t3" }),
      ]),
    ];

    const plan = findIndependentSets(graph, items, radii);

    // All three tasks should be in group 0 (no conflicts → all same color)
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].taskIds).toHaveLength(3);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("places overlapping tasks in different groups", () => {
    const radii = makeBlastRadii({
      t1: ["src/shared.ts", "src/a.ts"],
      t2: ["src/shared.ts", "src/b.ts"],
    });
    const graph = buildConflictGraph(radii);
    const items = [
      makeFeature("f1", [makeTask({ id: "t1" })]),
      makeFeature("f2", [makeTask({ id: "t2" })]),
    ];

    const plan = findIndependentSets(graph, items, radii);

    // Tasks conflict → different groups
    expect(plan.groups.length).toBeGreaterThanOrEqual(2);
    expect(areInSameGroup(plan, "t1", "t2")).toBe(false);
    expect(plan.conflicts).toHaveLength(1);
  });

  it("respects blockedBy dependencies — serial tasks excluded from groups", () => {
    const radii = makeBlastRadii({
      t1: ["src/a.ts"],
      t2: ["src/b.ts"],
    });
    const graph = buildConflictGraph(radii);
    const items = [
      makeFeature("f1", [
        makeTask({ id: "t1" }),
        makeTask({ id: "t2", blockedBy: ["t1"] }),
      ]),
    ];

    const plan = findIndependentSets(graph, items, radii);

    // Both tasks should be in serialTasks
    expect(plan.serialTasks).toContain("t1");
    expect(plan.serialTasks).toContain("t2");
    // Neither should appear in any group
    for (const group of plan.groups) {
      expect(group.taskIds).not.toContain("t1");
      expect(group.taskIds).not.toContain("t2");
    }
  });

  it("only marks tasks as serial when blocker is also in the actionable set", () => {
    const radii = makeBlastRadii({
      t2: ["src/b.ts"],
    });
    const graph = buildConflictGraph(radii);
    // t1 is not in the graph (not actionable), so t2 should not be serial
    const items = [
      makeFeature("f1", [
        makeTask({ id: "t1", status: "completed" }),
        makeTask({ id: "t2", blockedBy: ["t1"] }),
      ]),
    ];

    const plan = findIndependentSets(graph, items, radii);

    expect(plan.serialTasks).toHaveLength(0);
    // t2 should be in a group
    const allGroupTasks = plan.groups.flatMap((g) => g.taskIds);
    expect(allGroupTasks).toContain("t2");
  });

  it("places sibling tasks (same parent feature) in the same group", () => {
    const radii = makeBlastRadii({
      t1: ["src/a.ts"],
      t2: ["src/b.ts"],
      t3: ["src/c.ts"],
    });
    // t1 and t3 conflict, so they go to different groups
    // t1 and t2 are siblings under f1, so they must be in the same group
    const conflictRadii = makeBlastRadii({
      t1: ["src/shared.ts", "src/a.ts"],
      t2: ["src/b.ts"],
      t3: ["src/shared.ts", "src/c.ts"],
    });
    const graph = buildConflictGraph(conflictRadii);
    const items = [
      makeFeature("f1", [
        makeTask({ id: "t1" }),
        makeTask({ id: "t2" }),
      ]),
      makeFeature("f2", [
        makeTask({ id: "t3" }),
      ]),
    ];

    const plan = findIndependentSets(graph, items, conflictRadii);

    // t1 and t2 should be in the same group (siblings)
    expect(areInSameGroup(plan, "t1", "t2")).toBe(true);
    // t1 and t3 should be in different groups (conflict)
    expect(areInSameGroup(plan, "t1", "t3")).toBe(false);
  });

  it("sorts groups by estimated size (largest first)", () => {
    // Create two conflicting tasks with different blast radius sizes
    const radii = makeBlastRadii({
      t1: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"],
      t2: ["src/a.ts", "src/f.ts"],
    });
    const graph = buildConflictGraph(radii);
    const items = [
      makeFeature("f1", [makeTask({ id: "t1" })]),
      makeFeature("f2", [makeTask({ id: "t2" })]),
    ];

    const plan = findIndependentSets(graph, items, radii);

    // Group 0 should have the larger estimated size
    expect(plan.groups[0].estimatedSize).toBeGreaterThanOrEqual(
      plan.groups[plan.groups.length - 1].estimatedSize,
    );
  });

  it("includes all detected conflicts in the plan", () => {
    const radii = makeBlastRadii({
      t1: ["src/shared.ts"],
      t2: ["src/shared.ts"],
      t3: ["src/shared.ts"],
    });
    const graph = buildConflictGraph(radii);
    const items = [
      makeFeature("f1", [makeTask({ id: "t1" })]),
      makeFeature("f2", [makeTask({ id: "t2" })]),
      makeFeature("f3", [makeTask({ id: "t3" })]),
    ];

    const plan = findIndependentSets(graph, items, radii);

    // 3 tasks, all pairwise conflicting → 3 conflict edges
    expect(plan.conflicts).toHaveLength(3);
  });

  it("returns an ExecutionPlan with correct shape", () => {
    const radii = makeBlastRadii({
      t1: ["src/a.ts"],
    });
    const graph = buildConflictGraph(radii);
    const items = [makeFeature("f1", [makeTask({ id: "t1" })])];

    const plan = findIndependentSets(graph, items, radii);

    expect(plan).toHaveProperty("groups");
    expect(plan).toHaveProperty("serialTasks");
    expect(plan).toHaveProperty("conflicts");
    expect(Array.isArray(plan.groups)).toBe(true);
    expect(Array.isArray(plan.serialTasks)).toBe(true);
    expect(Array.isArray(plan.conflicts)).toBe(true);
  });

  it("assigns sequential group indices after sorting", () => {
    const radii = makeBlastRadii({
      t1: ["src/shared.ts", "src/a.ts"],
      t2: ["src/shared.ts", "src/b.ts"],
      t3: ["src/c.ts"],
    });
    const graph = buildConflictGraph(radii);
    const items = [
      makeFeature("f1", [makeTask({ id: "t1" })]),
      makeFeature("f2", [makeTask({ id: "t2" })]),
      makeFeature("f3", [makeTask({ id: "t3" })]),
    ];

    const plan = findIndependentSets(graph, items, radii);

    for (let i = 0; i < plan.groups.length; i++) {
      expect(plan.groups[i].index).toBe(i);
    }
  });

  it("handles empty graph", () => {
    const graph: ConflictGraph = new Map();
    const items: PRDItem[] = [];
    const radii = new Map<string, Set<string>>();

    const plan = findIndependentSets(graph, items, radii);

    expect(plan.groups).toHaveLength(0);
    expect(plan.serialTasks).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("handles graph with all serial tasks", () => {
    const radii = makeBlastRadii({
      t1: ["src/a.ts"],
      t2: ["src/b.ts"],
    });
    const graph = buildConflictGraph(radii);
    const items = [
      makeFeature("f1", [
        makeTask({ id: "t1" }),
        makeTask({ id: "t2", blockedBy: ["t1"] }),
      ]),
    ];

    const plan = findIndependentSets(graph, items, radii);

    expect(plan.serialTasks).toHaveLength(2);
    expect(plan.groups).toHaveLength(0);
  });

  it("conflicts have deduplicated and ordered task IDs", () => {
    const radii = makeBlastRadii({
      t1: ["src/shared.ts"],
      t2: ["src/shared.ts"],
    });
    const graph = buildConflictGraph(radii);
    const items = [
      makeFeature("f1", [makeTask({ id: "t1" })]),
      makeFeature("f2", [makeTask({ id: "t2" })]),
    ];

    const plan = findIndependentSets(graph, items, radii);

    // Should be exactly one conflict, not two (deduplicated)
    expect(plan.conflicts).toHaveLength(1);
    // taskA should be lexically before taskB
    expect(plan.conflicts[0].taskA < plan.conflicts[0].taskB).toBe(true);
  });

  it("complex scenario: mixed serial, sibling, and conflict constraints", () => {
    // t1, t2 are siblings under f1 (forced same group)
    // t3 conflicts with t1 (different group)
    // t4 is blocked by t5 (both serial)
    // t6 has no conflicts (goes in any group)
    const radii = makeBlastRadii({
      t1: ["src/shared.ts", "src/a.ts"],
      t2: ["src/b.ts"],
      t3: ["src/shared.ts", "src/c.ts"],
      t4: ["src/d.ts"],
      t5: ["src/e.ts"],
      t6: ["src/f.ts"],
    });
    const graph = buildConflictGraph(radii);
    const items = [
      makeFeature("f1", [
        makeTask({ id: "t1" }),
        makeTask({ id: "t2" }),
      ]),
      makeFeature("f2", [
        makeTask({ id: "t3" }),
      ]),
      makeFeature("f3", [
        makeTask({ id: "t4", blockedBy: ["t5"] }),
        makeTask({ id: "t5" }),
      ]),
      makeFeature("f4", [
        makeTask({ id: "t6" }),
      ]),
    ];

    const plan = findIndependentSets(graph, items, radii);

    // t4 and t5 are serial
    expect(plan.serialTasks).toContain("t4");
    expect(plan.serialTasks).toContain("t5");

    // t1 and t2 are in the same group (siblings)
    expect(areInSameGroup(plan, "t1", "t2")).toBe(true);

    // t1 and t3 are in different groups (conflict)
    expect(areInSameGroup(plan, "t1", "t3")).toBe(false);

    // t4, t5 should not be in any group
    const allGroupTasks = plan.groups.flatMap((g) => g.taskIds);
    expect(allGroupTasks).not.toContain("t4");
    expect(allGroupTasks).not.toContain("t5");

    // t6 should be in some group
    expect(allGroupTasks).toContain("t6");
  });

  it("group estimatedSize sums blast radii of member tasks", () => {
    const radii = makeBlastRadii({
      t1: ["src/a.ts", "src/b.ts"],
      t2: ["src/c.ts"],
    });
    const graph = buildConflictGraph(radii);
    const items = [
      makeFeature("f1", [makeTask({ id: "t1" })]),
      makeFeature("f2", [makeTask({ id: "t2" })]),
    ];

    const plan = findIndependentSets(graph, items, radii);

    // No conflicts → all in one group
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].estimatedSize).toBe(3); // 2 + 1
  });
});
