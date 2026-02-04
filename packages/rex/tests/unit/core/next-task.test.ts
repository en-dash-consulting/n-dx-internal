import { describe, it, expect } from "vitest";
import { findNextTask, findActionableTasks, collectCompletedIds, explainSelection } from "../../../src/core/next-task.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

describe("collectCompletedIds", () => {
  it("collects completed item ids", () => {
    const items: PRDItem[] = [
      makeItem({ id: "1", title: "A", status: "completed" }),
      makeItem({ id: "2", title: "B", status: "pending" }),
      makeItem({
        id: "3",
        title: "C",
        level: "epic",
        children: [
          makeItem({ id: "4", title: "D", status: "completed" }),
        ],
      }),
    ];
    const ids = collectCompletedIds(items);
    expect(ids).toEqual(new Set(["1", "4"]));
  });
});

describe("findNextTask", () => {
  it("returns first pending leaf", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result).not.toBeNull();
    expect(result!.item.id).toBe("t1");
  });

  it("skips completed items", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "completed" }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set(["t1"]));
    expect(result).not.toBeNull();
    expect(result!.item.id).toBe("t2");
  });

  it("skips deferred items", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "deferred" }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("skips blocked items", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "blocked" }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("skips items with unresolved blockers", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", blockedBy: ["t3"] }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("unblocks items when blockers are completed", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", blockedBy: ["t0"] }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set(["t0"]));
    expect(result!.item.id).toBe("t1");
  });

  it("prioritizes by priority (critical first)", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Low", priority: "low" }),
      makeItem({ id: "t2", title: "Critical", priority: "critical" }),
      makeItem({ id: "t3", title: "High", priority: "high" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("goes depth-first into children", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [
              makeItem({ id: "t1", title: "Deep Task" }),
            ],
          }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t1");
    expect(result!.parents.map((p) => p.id)).toEqual(["e1", "f1"]);
  });

  it("returns null when all done", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "completed" }),
      makeItem({ id: "t2", title: "Task 2", status: "deferred" }),
    ];
    const result = findNextTask(items, new Set(["t1"]));
    expect(result).toBeNull();
  });

  it("returns null for empty tree", () => {
    expect(findNextTask([], new Set())).toBeNull();
  });

  it("returns parent when all children are done", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "completed" }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set(["t1", "t2"]));
    expect(result).not.toBeNull();
    expect(result!.item.id).toBe("e1");
  });

  it("selects critical task in low-priority epic over medium task in high-priority epic", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "High Epic",
        level: "epic",
        priority: "high",
        children: [
          makeItem({ id: "t1", title: "Medium Task", priority: "medium" }),
        ],
      }),
      makeItem({
        id: "e2",
        title: "Low Epic",
        level: "epic",
        priority: "low",
        children: [
          makeItem({ id: "t2", title: "Critical Task", priority: "critical" }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("skips children when parent has unresolved blockedBy", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Blocked Epic",
        level: "epic",
        blockedBy: ["external"],
        children: [
          makeItem({ id: "t1", title: "Child of blocked" }),
        ],
      }),
      makeItem({ id: "t2", title: "Free task" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("skips children when ancestor has unresolved blockedBy", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Blocked Epic",
        level: "epic",
        blockedBy: ["external"],
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [
              makeItem({ id: "t1", title: "Deep child of blocked" }),
            ],
          }),
        ],
      }),
      makeItem({ id: "t2", title: "Free task" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("prefers in_progress tasks over pending tasks of same priority", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Pending high", priority: "high" }),
      makeItem({ id: "t2", title: "In progress high", priority: "high", status: "in_progress" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("prefers in_progress tasks even at lower priority", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Pending critical", priority: "critical" }),
      makeItem({ id: "t2", title: "In progress medium", priority: "medium", status: "in_progress" }),
    ];
    // in_progress should always come first — finish what you started
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("uses ancestor priority as tiebreaker for same-priority tasks", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Critical Epic",
        level: "epic",
        priority: "critical",
        children: [
          makeItem({ id: "t1", title: "AAA Task", priority: "medium" }),
        ],
      }),
      makeItem({
        id: "e2",
        title: "Low Epic",
        level: "epic",
        priority: "low",
        children: [
          makeItem({ id: "t2", title: "AAA Task", priority: "medium" }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t1");
  });
});

describe("explainSelection", () => {
  it("explains basic selection with priority", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", priority: "high" }),
      makeItem({ id: "t2", title: "Task 2", priority: "low" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.summary).toContain("high");
    expect(explanation.priority).toBeDefined();
    expect(explanation.priority.itemPriority).toBe("high");
  });

  it("explains default medium priority", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.priority.itemPriority).toBe("medium");
    expect(explanation.summary).toContain("medium");
  });

  it("includes resolved dependency info", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Blocker", status: "completed" }),
      makeItem({ id: "t2", title: "Task 2", blockedBy: ["t1"] }),
    ];
    const completedIds = new Set(["t1"]);
    const result = findNextTask(items, completedIds)!;
    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.dependencies.status).toBe("resolved");
    expect(explanation.dependencies.resolvedBlockers).toContain("t1");
  });

  it("reports no dependencies when none exist", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.dependencies.status).toBe("none");
  });

  it("counts skipped items by reason", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Done", status: "completed" }),
      makeItem({ id: "t2", title: "Deferred", status: "deferred" }),
      makeItem({ id: "t3", title: "Blocked", status: "blocked" }),
      makeItem({ id: "t4", title: "Waiting", blockedBy: ["t99"] }),
      makeItem({ id: "t5", title: "Selected" }),
    ];
    const completedIds = new Set(["t1"]);
    const result = findNextTask(items, completedIds)!;
    expect(result.item.id).toBe("t5");

    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.skipped.completed).toBe(1);
    expect(explanation.skipped.deferred).toBe(1);
    expect(explanation.skipped.blocked).toBe(1);
    expect(explanation.skipped.unresolvedDeps).toBe(1);
    expect(explanation.skipped.total).toBe(4);
  });

  it("explains depth-first traversal path", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic 1",
        level: "epic",
        priority: "high",
        children: [
          makeItem({
            id: "f1",
            title: "Feature 1",
            level: "feature",
            children: [
              makeItem({ id: "t1", title: "Deep Task" }),
            ],
          }),
        ],
      }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.summary).toContain("Deep Task");
    expect(explanation.traversalPath).toEqual(["Epic 1", "Feature 1"]);
  });

  it("notes when higher-priority items exist but are blocked", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Critical blocked", priority: "critical", blockedBy: ["t99"] }),
      makeItem({ id: "t2", title: "Low available", priority: "low" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    expect(result.item.id).toBe("t2");

    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.priority.higherPriorityBlocked).toBe(1);
  });

  it("explains in-progress task selection", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "In progress", status: "in_progress" }),
      makeItem({ id: "t2", title: "Pending" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    expect(result.item.id).toBe("t1");

    const explanation = explainSelection(items, result, completedIds);
    expect(explanation.summary).toContain("in_progress");
  });

  it("explains parent completion selection", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({ id: "t1", title: "Done", status: "completed" }),
          makeItem({ id: "t2", title: "Done too", status: "completed" }),
        ],
      }),
    ];
    const completedIds = new Set(["t1", "t2"]);
    const result = findNextTask(items, completedIds)!;
    expect(result.item.id).toBe("e1");

    const explanation = explainSelection(items, result, completedIds);
    expect(explanation.summary).toContain("children completed");
  });
});

describe("findActionableTasks", () => {
  it("returns actionable tasks sorted by priority", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Low", priority: "low" }),
      makeItem({ id: "t2", title: "Critical", priority: "critical" }),
      makeItem({ id: "t3", title: "Medium", priority: "medium" }),
    ];
    const results = findActionableTasks(items, new Set());
    expect(results.map((r) => r.item.id)).toEqual(["t2", "t3", "t1"]);
  });

  it("ranks in_progress tasks before pending at same priority", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Pending high", priority: "high" }),
      makeItem({ id: "t2", title: "In progress high", priority: "high", status: "in_progress" }),
      makeItem({ id: "t3", title: "Pending medium", priority: "medium" }),
    ];
    const results = findActionableTasks(items, new Set());
    expect(results[0].item.id).toBe("t2");
  });

  it("skips children of blocked parents", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Blocked Epic",
        level: "epic",
        blockedBy: ["external"],
        children: [
          makeItem({ id: "t1", title: "Child of blocked" }),
        ],
      }),
      makeItem({ id: "t2", title: "Free task" }),
    ];
    const results = findActionableTasks(items, new Set());
    expect(results.map((r) => r.item.id)).toEqual(["t2"]);
  });

  it("selects critical tasks across epics regardless of epic priority", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "High Epic",
        level: "epic",
        priority: "high",
        children: [
          makeItem({ id: "t1", title: "Medium Task", priority: "medium" }),
        ],
      }),
      makeItem({
        id: "e2",
        title: "Low Epic",
        level: "epic",
        priority: "low",
        children: [
          makeItem({ id: "t2", title: "Critical Task", priority: "critical" }),
        ],
      }),
    ];
    const results = findActionableTasks(items, new Set());
    expect(results[0].item.id).toBe("t2");
  });

  it("respects limit parameter", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "A" }),
      makeItem({ id: "t2", title: "B" }),
      makeItem({ id: "t3", title: "C" }),
    ];
    const results = findActionableTasks(items, new Set(), 2);
    expect(results).toHaveLength(2);
  });
});
