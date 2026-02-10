import { describe, it, expect } from "vitest";
import {
  findNextTask,
  findActionableTasks,
  collectCompletedIds,
  requirementsScore,
} from "../../../src/core/next-task.js";
import type { PRDItem, Requirement } from "../../../src/schema/index.js";

function makeReq(overrides: Partial<Requirement> & { id: string; title: string }): Requirement {
  return {
    category: "technical",
    validationType: "automated",
    acceptanceCriteria: ["Must pass"],
    ...overrides,
  };
}

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

describe("requirementsScore", () => {
  it("returns 0 for tasks with no requirements", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "No reqs" }),
    ];
    const entry = { item: items[0], parents: [] };
    expect(requirementsScore(entry, items)).toBe(0);
  });

  it("scores tasks with own requirements", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "Has reqs",
        requirements: [
          makeReq({ id: "r1", title: "Req 1", category: "technical", priority: "medium" }),
        ],
      }),
    ];
    const entry = { item: items[0], parents: [] };
    const score = requirementsScore(entry, items);
    expect(score).toBeGreaterThan(0);
  });

  it("gives higher score to critical priority requirements", () => {
    const criticalItems: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "Critical",
        requirements: [
          makeReq({ id: "r1", title: "Critical req", priority: "critical" }),
        ],
      }),
    ];
    const lowItems: PRDItem[] = [
      makeItem({
        id: "t2",
        title: "Low",
        requirements: [
          makeReq({ id: "r2", title: "Low req", priority: "low" }),
        ],
      }),
    ];

    const criticalScore = requirementsScore({ item: criticalItems[0], parents: [] }, criticalItems);
    const lowScore = requirementsScore({ item: lowItems[0], parents: [] }, lowItems);
    expect(criticalScore).toBeGreaterThan(lowScore);
  });

  it("gives higher score to security requirements", () => {
    const secItems: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "Security",
        requirements: [
          makeReq({ id: "r1", title: "Auth req", category: "security", priority: "medium" }),
        ],
      }),
    ];
    const techItems: PRDItem[] = [
      makeItem({
        id: "t2",
        title: "Technical",
        requirements: [
          makeReq({ id: "r2", title: "Tech req", category: "technical", priority: "medium" }),
        ],
      }),
    ];

    const secScore = requirementsScore({ item: secItems[0], parents: [] }, secItems);
    const techScore = requirementsScore({ item: techItems[0], parents: [] }, techItems);
    expect(secScore).toBeGreaterThan(techScore);
  });

  it("gives higher score to performance requirements", () => {
    const perfItems: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "Performance",
        requirements: [
          makeReq({ id: "r1", title: "Perf req", category: "performance", priority: "medium" }),
        ],
      }),
    ];
    const qualItems: PRDItem[] = [
      makeItem({
        id: "t2",
        title: "Quality",
        requirements: [
          makeReq({ id: "r2", title: "Quality req", category: "quality", priority: "medium" }),
        ],
      }),
    ];

    const perfScore = requirementsScore({ item: perfItems[0], parents: [] }, perfItems);
    const qualScore = requirementsScore({ item: qualItems[0], parents: [] }, qualItems);
    expect(perfScore).toBeGreaterThan(qualScore);
  });

  it("accumulates score from inherited parent requirements", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "epic-1",
        title: "Epic",
        level: "epic",
        requirements: [
          makeReq({ id: "r1", title: "Epic req", category: "security", priority: "critical" }),
        ],
        children: [
          makeItem({ id: "t1", title: "Task" }),
        ],
      }),
    ];

    const entry = { item: items[0].children![0], parents: [items[0]] };
    const score = requirementsScore(entry, items);
    expect(score).toBeGreaterThan(0);
  });

  it("respects risk tolerance: low tolerance gives highest scores", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "Has security",
        requirements: [
          makeReq({ id: "r1", title: "Security req", category: "security", priority: "critical" }),
        ],
      }),
    ];
    const entry = { item: items[0], parents: [] };

    const lowScore = requirementsScore(entry, items, "low");
    const medScore = requirementsScore(entry, items, "medium");
    const highScore = requirementsScore(entry, items, "high");

    expect(lowScore).toBeGreaterThan(medScore);
    expect(medScore).toBeGreaterThan(highScore);
  });
});

describe("findNextTask with requirements", () => {
  it("prefers tasks with critical requirements at same priority level", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "AAA No reqs",
        priority: "medium",
      }),
      makeItem({
        id: "t2",
        title: "ZZZ Has critical reqs",
        priority: "medium",
        requirements: [
          makeReq({ id: "r1", title: "Critical security", category: "security", priority: "critical" }),
        ],
      }),
    ];

    const result = findNextTask(items, new Set());
    expect(result).not.toBeNull();
    // t2 should win despite alphabetical disadvantage, due to requirements score
    expect(result!.item.id).toBe("t2");
  });

  it("does not override explicit priority with requirements", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "High priority no reqs",
        priority: "high",
      }),
      makeItem({
        id: "t2",
        title: "Low priority with reqs",
        priority: "low",
        requirements: [
          makeReq({ id: "r1", title: "Critical req", category: "security", priority: "critical" }),
        ],
      }),
    ];

    const result = findNextTask(items, new Set());
    expect(result).not.toBeNull();
    // Priority ordering (tier 2) still beats requirements score (tier 3)
    expect(result!.item.id).toBe("t1");
  });

  it("uses riskTolerance option to control requirements influence", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "AAA No reqs",
        priority: "medium",
      }),
      makeItem({
        id: "t2",
        title: "ZZZ Has reqs",
        priority: "medium",
        requirements: [
          makeReq({ id: "r1", title: "Tech req", category: "technical", priority: "medium" }),
        ],
      }),
    ];

    // With medium risk tolerance, requirements should still influence
    const resultMed = findNextTask(items, new Set(), { riskTolerance: "medium" });
    expect(resultMed).not.toBeNull();
    // t2 has requirements score > 0, t1 has 0
    expect(resultMed!.item.id).toBe("t2");
  });

  it("findActionableTasks respects limit with prioritization options", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "A", priority: "medium" }),
      makeItem({ id: "t2", title: "B", priority: "medium" }),
      makeItem({ id: "t3", title: "C", priority: "medium" }),
    ];

    const results = findActionableTasks(items, new Set(), 2, { riskTolerance: "low" });
    expect(results).toHaveLength(2);
  });

  it("in_progress still takes priority over requirements score", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "In progress",
        priority: "medium",
        status: "in_progress",
      }),
      makeItem({
        id: "t2",
        title: "Has critical reqs",
        priority: "medium",
        requirements: [
          makeReq({ id: "r1", title: "Critical", category: "security", priority: "critical" }),
        ],
      }),
    ];

    const result = findNextTask(items, new Set());
    expect(result).not.toBeNull();
    expect(result!.item.id).toBe("t1");
  });
});
