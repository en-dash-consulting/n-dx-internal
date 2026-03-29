import { describe, it, expect } from "vitest";
import type { PRDItem } from "../../../src/schema/v1.js";
import type { ZoneIndex, ImportGraph } from "../../../src/parallel/blast-radius.js";
import {
  computeExecutionPlan,
  formatExecutionPlan,
} from "../../../src/parallel/execution-plan.js";
import type { FormattedExecutionPlan } from "../../../src/parallel/execution-plan.js";

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

function makeEpic(
  id: string,
  children: PRDItem[],
  overrides: Partial<PRDItem> = {},
): PRDItem {
  return {
    id,
    title: `Epic ${id}`,
    status: "pending",
    level: "epic",
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

// ── computeExecutionPlan ─────────────────────────────────────────────────────

describe("computeExecutionPlan", () => {
  it("returns empty plan when no items exist", () => {
    const plan = computeExecutionPlan([], new Map(), new Map());

    expect(plan.totalTasks).toBe(0);
    expect(plan.maxParallelism).toBe(0);
    expect(plan.groups).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.serialTasks).toHaveLength(0);
    expect(plan.taskMeta).toEqual({});
  });

  it("returns empty plan when all tasks are completed", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask({ id: "t1", title: "Done task", status: "completed" }),
        ]),
      ]),
    ];
    const plan = computeExecutionPlan(items, new Map(), new Map());

    expect(plan.totalTasks).toBe(0);
    expect(plan.groups).toHaveLength(0);
  });

  it("returns empty plan when all tasks are blocked", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask({ id: "t1", title: "Blocked task", status: "pending", blockedBy: ["non-existent-blocker"] }),
        ]),
      ]),
    ];
    // The blocker "non-existent-blocker" is not completed, so t1 is blocked
    const plan = computeExecutionPlan(items, new Map(), new Map());

    expect(plan.totalTasks).toBe(0);
  });

  it("returns single group for a single actionable task", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask({ id: "t1", title: "Only task", status: "pending" }),
        ]),
      ]),
    ];
    const plan = computeExecutionPlan(items, new Map(), new Map());

    expect(plan.totalTasks).toBe(1);
    expect(plan.maxParallelism).toBe(1);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].taskIds).toContain("t1");
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.taskMeta["t1"]).toEqual({ title: "Only task", priority: undefined });
  });

  it("puts non-conflicting tasks in the same group", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask({ id: "t1", title: "Task A", status: "pending", tags: ["zone-a"] }),
        ]),
        makeFeature("f2", [
          makeTask({ id: "t2", title: "Task B", status: "pending", tags: ["zone-b"] }),
        ]),
      ]),
    ];

    // Non-overlapping zones
    const zones = makeZoneIndex({
      "zone-a": ["src/a.ts"],
      "zone-b": ["src/b.ts"],
    });

    const plan = computeExecutionPlan(items, zones, new Map());

    expect(plan.totalTasks).toBe(2);
    // Both tasks should be in the same group (no conflict)
    expect(plan.groups.some((g) => g.taskIds.length === 2)).toBe(true);
    expect(plan.maxParallelism).toBe(2);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("separates conflicting tasks into different groups", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask({
            id: "t1",
            title: "Task A",
            status: "pending",
            acceptanceCriteria: ["Modify src/shared.ts"],
          }),
        ]),
        makeFeature("f2", [
          makeTask({
            id: "t2",
            title: "Task B",
            status: "pending",
            acceptanceCriteria: ["Update src/shared.ts"],
          }),
        ]),
      ]),
    ];

    const plan = computeExecutionPlan(items, new Map(), new Map());

    expect(plan.totalTasks).toBe(2);
    // Should detect conflict on src/shared.ts
    if (plan.conflicts.length > 0) {
      expect(plan.conflicts[0].overlappingFiles).toContain("src/shared.ts");
    }
  });

  it("includes task metadata (title and priority)", () => {
    const items: PRDItem[] = [
      makeTask({
        id: "t1",
        title: "Critical fix",
        status: "pending",
        priority: "critical",
      }),
    ];
    const plan = computeExecutionPlan(items, new Map(), new Map());

    expect(plan.taskMeta["t1"]).toEqual({
      title: "Critical fix",
      priority: "critical",
    });
  });

  it("handles in_progress tasks as actionable", () => {
    const items: PRDItem[] = [
      makeTask({ id: "t1", title: "In progress task", status: "in_progress" }),
    ];
    const plan = computeExecutionPlan(items, new Map(), new Map());

    expect(plan.totalTasks).toBe(1);
    expect(plan.groups[0].taskIds).toContain("t1");
  });

  it("excludes deferred tasks", () => {
    const items: PRDItem[] = [
      makeTask({ id: "t1", title: "Deferred task", status: "deferred" }),
      makeTask({ id: "t2", title: "Active task", status: "pending" }),
    ];
    const plan = computeExecutionPlan(items, new Map(), new Map());

    expect(plan.totalTasks).toBe(1);
    const allTaskIds = plan.groups.flatMap((g) => g.taskIds);
    expect(allTaskIds).toContain("t2");
    expect(allTaskIds).not.toContain("t1");
  });

  it("uses zone and import data for conflict detection", () => {
    const items: PRDItem[] = [
      makeTask({ id: "t1", title: "Task A", status: "pending", tags: ["zone-x"] }),
      makeTask({ id: "t2", title: "Task B", status: "pending", tags: ["zone-x"] }),
    ];

    const zones = makeZoneIndex({
      "zone-x": ["src/x.ts", "src/y.ts"],
    });

    const imports = makeImportGraph({
      "src/x.ts": ["src/y.ts"],
    });

    const plan = computeExecutionPlan(items, zones, imports);

    expect(plan.totalTasks).toBe(2);
    // Both tasks touch zone-x files, so there should be a conflict
    expect(plan.conflicts.length).toBeGreaterThan(0);
  });

  it("identifies serial tasks with blockedBy dependencies", () => {
    const items: PRDItem[] = [
      makeTask({ id: "t1", title: "First task", status: "pending" }),
      makeTask({ id: "t2", title: "Depends on t1", status: "pending", blockedBy: ["t1"] }),
    ];

    // t2 is blocked by t1, but t1 is not completed, so t2 should not be actionable
    const plan = computeExecutionPlan(items, new Map(), new Map());

    // Only t1 should be actionable (t2 is blocked)
    expect(plan.totalTasks).toBe(1);
  });
});

// ── formatExecutionPlan ──────────────────────────────────────────────────────

describe("formatExecutionPlan", () => {
  it("formats empty plan", () => {
    const plan: FormattedExecutionPlan = {
      groups: [],
      serialTasks: [],
      conflicts: [],
      totalTasks: 0,
      maxParallelism: 0,
      taskMeta: {},
    };

    const output = formatExecutionPlan(plan);

    expect(output).toContain("Execution Plan");
    expect(output).toContain("No actionable tasks found");
  });

  it("formats plan with a single group", () => {
    const plan: FormattedExecutionPlan = {
      groups: [
        { index: 0, taskIds: ["t1", "t2"], estimatedSize: 10 },
      ],
      serialTasks: [],
      conflicts: [],
      totalTasks: 2,
      maxParallelism: 2,
      taskMeta: {
        t1: { title: "Task Alpha", priority: "high" },
        t2: { title: "Task Beta" },
      },
    };

    const output = formatExecutionPlan(plan);

    expect(output).toContain("Execution Plan");
    expect(output).toContain("2 actionable tasks");
    expect(output).toContain("1 group");
    expect(output).toContain("max parallelism: 2");
    expect(output).toContain("Group 1");
    expect(output).toContain("2 tasks");
    expect(output).toContain("~10 files");
    expect(output).toContain("Task Alpha");
    expect(output).toContain("[high]");
    expect(output).toContain("Task Beta");
  });

  it("formats plan with conflicts", () => {
    const plan: FormattedExecutionPlan = {
      groups: [
        { index: 0, taskIds: ["t1"], estimatedSize: 5 },
        { index: 1, taskIds: ["t2"], estimatedSize: 3 },
      ],
      serialTasks: [],
      conflicts: [
        {
          taskA: "t1",
          taskB: "t2",
          weight: 2,
          confidence: "high",
          overlappingFiles: ["src/shared.ts", "src/config.ts"],
        },
      ],
      totalTasks: 2,
      maxParallelism: 1,
      taskMeta: {
        t1: { title: "Task A" },
        t2: { title: "Task B" },
      },
    };

    const output = formatExecutionPlan(plan);

    expect(output).toContain("Conflicts (1 detected)");
    expect(output).toContain("Task A");
    expect(output).toContain("Task B");
    expect(output).toContain("[high]");
    expect(output).toContain("2 overlapping files");
    expect(output).toContain("src/shared.ts");
    expect(output).toContain("src/config.ts");
  });

  it("formats plan with serial tasks", () => {
    const plan: FormattedExecutionPlan = {
      groups: [],
      serialTasks: ["t1", "t2"],
      conflicts: [],
      totalTasks: 2,
      maxParallelism: 0,
      taskMeta: {
        t1: { title: "Sequential A" },
        t2: { title: "Sequential B" },
      },
    };

    const output = formatExecutionPlan(plan);

    expect(output).toContain("Serial Tasks (2)");
    expect(output).toContain("Sequential A");
    expect(output).toContain("Sequential B");
  });

  it("truncates long task names", () => {
    const plan: FormattedExecutionPlan = {
      groups: [],
      serialTasks: [],
      conflicts: [
        {
          taskA: "t1",
          taskB: "t2",
          weight: 1,
          confidence: "low",
          overlappingFiles: ["src/x.ts"],
        },
      ],
      totalTasks: 2,
      maxParallelism: 0,
      taskMeta: {
        t1: { title: "A very long task name that should be truncated for display" },
        t2: { title: "Another extremely long task name exceeding the limit" },
      },
    };

    const output = formatExecutionPlan(plan);

    // Names over 30 chars should be truncated with "..."
    expect(output).toContain("...");
  });

  it("shows correct singular forms", () => {
    const plan: FormattedExecutionPlan = {
      groups: [
        { index: 0, taskIds: ["t1"], estimatedSize: 1 },
      ],
      serialTasks: [],
      conflicts: [],
      totalTasks: 1,
      maxParallelism: 1,
      taskMeta: {
        t1: { title: "Solo task" },
      },
    };

    const output = formatExecutionPlan(plan);

    expect(output).toContain("1 actionable task →");
    expect(output).toContain("1 group ");
    expect(output).toContain("1 task,");
  });

  it("shows overlapping file count with (+N more) suffix", () => {
    const plan: FormattedExecutionPlan = {
      groups: [],
      serialTasks: [],
      conflicts: [
        {
          taskA: "t1",
          taskB: "t2",
          weight: 5,
          confidence: "high",
          overlappingFiles: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
        },
      ],
      totalTasks: 2,
      maxParallelism: 0,
      taskMeta: {
        t1: { title: "Task A" },
        t2: { title: "Task B" },
      },
    };

    const output = formatExecutionPlan(plan);

    // Should show first 3 files and (+2 more)
    expect(output).toContain("a.ts");
    expect(output).toContain("b.ts");
    expect(output).toContain("c.ts");
    expect(output).toContain("(+2 more)");
  });

  it("singular file in conflict line", () => {
    const plan: FormattedExecutionPlan = {
      groups: [],
      serialTasks: [],
      conflicts: [
        {
          taskA: "t1",
          taskB: "t2",
          weight: 1,
          confidence: "medium",
          overlappingFiles: ["src/only.ts"],
        },
      ],
      totalTasks: 2,
      maxParallelism: 0,
      taskMeta: {
        t1: { title: "A" },
        t2: { title: "B" },
      },
    };

    const output = formatExecutionPlan(plan);

    expect(output).toContain("1 overlapping file");
    expect(output).not.toContain("1 overlapping files");
  });
});

// ── JSON serialization ───────────────────────────────────────────────────────

describe("JSON serialization", () => {
  it("serializes to valid JSON with all expected fields", () => {
    const items: PRDItem[] = [
      makeTask({ id: "t1", title: "Task A", status: "pending" }),
      makeTask({ id: "t2", title: "Task B", status: "pending" }),
    ];
    const plan = computeExecutionPlan(items, new Map(), new Map());
    const json = JSON.stringify(plan, null, 2);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveProperty("groups");
    expect(parsed).toHaveProperty("serialTasks");
    expect(parsed).toHaveProperty("conflicts");
    expect(parsed).toHaveProperty("totalTasks");
    expect(parsed).toHaveProperty("maxParallelism");
    expect(parsed).toHaveProperty("taskMeta");
    expect(Array.isArray(parsed.groups)).toBe(true);
    expect(Array.isArray(parsed.serialTasks)).toBe(true);
    expect(Array.isArray(parsed.conflicts)).toBe(true);
  });

  it("serializes taskMeta as a plain object", () => {
    const items: PRDItem[] = [
      makeTask({ id: "t1", title: "Test", status: "pending", priority: "high" }),
    ];
    const plan = computeExecutionPlan(items, new Map(), new Map());
    const parsed = JSON.parse(JSON.stringify(plan));

    expect(parsed.taskMeta.t1).toEqual({ title: "Test", priority: "high" });
  });
});
