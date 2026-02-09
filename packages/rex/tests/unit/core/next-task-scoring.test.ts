import { describe, it, expect } from "vitest";
import {
  findNextTask,
  findActionableTasks,
  collectCompletedIds,
  siblingCompletionRatio,
  countDependents,
} from "../../../src/core/next-task.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// siblingCompletionRatio
// ---------------------------------------------------------------------------

describe("siblingCompletionRatio", () => {
  it("returns 0 for root-level items with no parents", () => {
    const ratio = siblingCompletionRatio({ item: makeItem({ id: "t1", title: "Root" }), parents: [] });
    expect(ratio).toBe(0);
  });

  it("returns 0 when no siblings are completed", () => {
    const parent = makeItem({
      id: "f1",
      title: "Feature",
      level: "feature",
      children: [
        makeItem({ id: "t1", title: "Task 1" }),
        makeItem({ id: "t2", title: "Task 2" }),
        makeItem({ id: "t3", title: "Task 3" }),
      ],
    });
    const ratio = siblingCompletionRatio({
      item: parent.children![0],
      parents: [parent],
    });
    expect(ratio).toBe(0);
  });

  it("returns correct ratio when some siblings are completed", () => {
    const parent = makeItem({
      id: "f1",
      title: "Feature",
      level: "feature",
      children: [
        makeItem({ id: "t1", title: "Task 1", status: "completed" }),
        makeItem({ id: "t2", title: "Task 2", status: "completed" }),
        makeItem({ id: "t3", title: "Task 3" }),
      ],
    });
    // t3 has 2/3 siblings completed (including itself in total)
    const ratio = siblingCompletionRatio({
      item: parent.children![2],
      parents: [parent],
    });
    expect(ratio).toBeCloseTo(2 / 3);
  });

  it("counts deferred siblings as completed for ratio", () => {
    const parent = makeItem({
      id: "f1",
      title: "Feature",
      level: "feature",
      children: [
        makeItem({ id: "t1", title: "Task 1", status: "completed" }),
        makeItem({ id: "t2", title: "Task 2", status: "deferred" }),
        makeItem({ id: "t3", title: "Task 3" }),
      ],
    });
    const ratio = siblingCompletionRatio({
      item: parent.children![2],
      parents: [parent],
    });
    expect(ratio).toBeCloseTo(2 / 3);
  });

  it("returns 0 when only child (no siblings)", () => {
    const parent = makeItem({
      id: "f1",
      title: "Feature",
      level: "feature",
      children: [
        makeItem({ id: "t1", title: "Only Task" }),
      ],
    });
    const ratio = siblingCompletionRatio({
      item: parent.children![0],
      parents: [parent],
    });
    expect(ratio).toBe(0);
  });

  it("uses immediate parent to determine siblings", () => {
    const epic = makeItem({
      id: "e1",
      title: "Epic",
      level: "epic",
      children: [
        makeItem({
          id: "f1",
          title: "Feature",
          level: "feature",
          children: [
            makeItem({ id: "t1", title: "Done", status: "completed" }),
            makeItem({ id: "t2", title: "Selected" }),
          ],
        }),
      ],
    });
    const ratio = siblingCompletionRatio({
      item: epic.children![0].children![1],
      parents: [epic, epic.children![0]],
    });
    expect(ratio).toBeCloseTo(1 / 2);
  });
});

// ---------------------------------------------------------------------------
// countDependents
// ---------------------------------------------------------------------------

describe("countDependents", () => {
  it("returns 0 when no items depend on the task", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    expect(countDependents("t1", items)).toBe(0);
  });

  it("counts items that list the task in their blockedBy", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Blocker" }),
      makeItem({ id: "t2", title: "Blocked A", blockedBy: ["t1"] }),
      makeItem({ id: "t3", title: "Blocked B", blockedBy: ["t1"] }),
      makeItem({ id: "t4", title: "Independent" }),
    ];
    expect(countDependents("t1", items)).toBe(2);
  });

  it("counts nested dependents", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Blocker" }),
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({ id: "t2", title: "Nested blocked", blockedBy: ["t1"] }),
        ],
      }),
    ];
    expect(countDependents("t1", items)).toBe(1);
  });

  it("does not count items where the task is only one of multiple blockers", () => {
    // This still counts — we want to know total dependents, even partial
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Blocker 1" }),
      makeItem({ id: "t2", title: "Blocker 2" }),
      makeItem({ id: "t3", title: "Blocked by both", blockedBy: ["t1", "t2"] }),
    ];
    // t3 lists t1 in blockedBy, so it's a dependent
    expect(countDependents("t1", items)).toBe(1);
  });

  it("returns 0 for non-existent task id", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
    ];
    expect(countDependents("nonexistent", items)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: findNextTask with advanced scoring
// ---------------------------------------------------------------------------

describe("findNextTask — sibling completion tiebreaker", () => {
  it("prefers task in nearly-complete feature over task in fresh feature", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Nearly done feature",
        level: "feature",
        children: [
          makeItem({ id: "t1", title: "Done 1", status: "completed" }),
          makeItem({ id: "t2", title: "Done 2", status: "completed" }),
          makeItem({ id: "t3", title: "Last task", priority: "medium" }),
        ],
      }),
      makeItem({
        id: "f2",
        title: "Fresh feature",
        level: "feature",
        children: [
          makeItem({ id: "t4", title: "First task", priority: "medium" }),
          makeItem({ id: "t5", title: "Second task" }),
          makeItem({ id: "t6", title: "Third task" }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set(["t1", "t2"]));
    expect(result).not.toBeNull();
    // t3 should win: 2/3 siblings done vs 0/3 for t4
    expect(result!.item.id).toBe("t3");
  });

  it("still respects priority over sibling completion", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Nearly done feature",
        level: "feature",
        children: [
          makeItem({ id: "t1", title: "Done", status: "completed" }),
          makeItem({ id: "t2", title: "Last task", priority: "low" }),
        ],
      }),
      makeItem({
        id: "f2",
        title: "Fresh feature",
        level: "feature",
        children: [
          makeItem({ id: "t3", title: "High prio task", priority: "high" }),
          makeItem({ id: "t4", title: "Other task" }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set(["t1"]));
    // t3 wins because high > low priority, even though t2's feature is nearly done
    expect(result!.item.id).toBe("t3");
  });
});

describe("findNextTask — unblock potential tiebreaker", () => {
  it("prefers task that unblocks more downstream work", () => {
    const items: PRDItem[] = [
      // t1 unblocks t3, t4, t5 (3 dependents)
      makeItem({ id: "t1", title: "Key blocker", priority: "medium" }),
      // t2 unblocks t6 only (1 dependent)
      makeItem({ id: "t2", title: "Minor blocker", priority: "medium" }),
      makeItem({ id: "t3", title: "Blocked by t1", blockedBy: ["t1"] }),
      makeItem({ id: "t4", title: "Also blocked by t1", blockedBy: ["t1"] }),
      makeItem({ id: "t5", title: "Third blocked by t1", blockedBy: ["t1"] }),
      makeItem({ id: "t6", title: "Blocked by t2", blockedBy: ["t2"] }),
    ];
    const result = findNextTask(items, new Set());
    // t1 should win: unblocks 3 vs t2's 1
    expect(result!.item.id).toBe("t1");
  });

  it("prefers task that unblocks work over task with zero dependents", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Blocker task", priority: "medium" }),
      makeItem({ id: "t2", title: "Independent task", priority: "medium" }),
      makeItem({ id: "t3", title: "Waits for t1", blockedBy: ["t1"] }),
    ];
    const result = findNextTask(items, new Set());
    // t1 unblocks 1 task, t2 unblocks 0
    expect(result!.item.id).toBe("t1");
  });

  it("sibling completion wins over unblock potential", () => {
    // Both tiebreakers at same priority — sibling completion applies first
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Nearly done feature",
        level: "feature",
        children: [
          makeItem({ id: "t1", title: "Done", status: "completed" }),
          makeItem({ id: "t2", title: "Last task", priority: "medium" }),
        ],
      }),
      // t3 unblocks t4 but has no sibling progress
      makeItem({ id: "t3", title: "Unblocks stuff", priority: "medium" }),
      makeItem({ id: "t4", title: "Waiting", blockedBy: ["t3"] }),
    ];
    const result = findNextTask(items, new Set(["t1"]));
    // t2 wins on sibling completion (1/2) vs t3 (root, 0)
    expect(result!.item.id).toBe("t2");
  });
});

describe("findActionableTasks — advanced scoring ordering", () => {
  it("orders by sibling completion when priority and ancestors are equal", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Mostly done",
            level: "feature",
            children: [
              makeItem({ id: "t1", title: "Done", status: "completed" }),
              makeItem({ id: "t2", title: "Done too", status: "completed" }),
              makeItem({ id: "t3", title: "Finish me", priority: "medium" }),
            ],
          }),
          makeItem({
            id: "f2",
            title: "Just started",
            level: "feature",
            children: [
              makeItem({ id: "t4", title: "First of many", priority: "medium" }),
              makeItem({ id: "t5", title: "Another" }),
              makeItem({ id: "t6", title: "Yet another" }),
            ],
          }),
        ],
      }),
    ];
    const results = findActionableTasks(items, new Set(["t1", "t2"]));
    // t3 (2/3 siblings done) should rank before t4 (0/3 siblings done)
    const t3idx = results.findIndex((r) => r.item.id === "t3");
    const t4idx = results.findIndex((r) => r.item.id === "t4");
    expect(t3idx).toBeLessThan(t4idx);
  });

  it("orders by unblock potential when sibling ratios are equal", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Big blocker", priority: "medium" }),
      makeItem({ id: "t2", title: "Small blocker", priority: "medium" }),
      makeItem({ id: "d1", title: "Dep 1", blockedBy: ["t1"] }),
      makeItem({ id: "d2", title: "Dep 2", blockedBy: ["t1"] }),
      makeItem({ id: "d3", title: "Dep 3", blockedBy: ["t2"] }),
    ];
    const results = findActionableTasks(items, new Set());
    const t1idx = results.findIndex((r) => r.item.id === "t1");
    const t2idx = results.findIndex((r) => r.item.id === "t2");
    // t1 unblocks 2, t2 unblocks 1
    expect(t1idx).toBeLessThan(t2idx);
  });
});
