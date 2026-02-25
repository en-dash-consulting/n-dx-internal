import { describe, it, expect } from "vitest";

import {
  renderPRMarkdownFromRecord,
  groupItemsByEpic,
  extractBreakingChanges,
  extractMajorChanges,
  renderEpicSection,
  renderBreakingChangesSection,
  renderMajorChangesSection,
  renderSummarySection,
} from "../../../src/generators/pr-markdown-template.js";
import type {
  BranchWorkRecord,
  BranchWorkRecordItem,
  BranchWorkEpicSummary,
} from "../../../src/schema/v1.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<BranchWorkRecordItem> = {}): BranchWorkRecordItem {
  return {
    id: overrides.id ?? "task-1",
    title: overrides.title ?? "Test task",
    level: overrides.level ?? "task",
    completedAt: overrides.completedAt ?? "2026-02-24T10:00:00.000Z",
    parentChain: overrides.parentChain ?? [],
    ...overrides,
  };
}

function makeRecord(overrides: Partial<BranchWorkRecord> = {}): BranchWorkRecord {
  return {
    schemaVersion: "1.0.0",
    branch: overrides.branch ?? "feature/test-branch",
    baseBranch: overrides.baseBranch ?? "main",
    createdAt: overrides.createdAt ?? "2026-02-24T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-02-24T12:00:00.000Z",
    items: overrides.items ?? [makeItem()],
    epicSummaries: overrides.epicSummaries ?? [],
    metadata: overrides.metadata ?? {},
  };
}

// ---------------------------------------------------------------------------
// groupItemsByEpic
// ---------------------------------------------------------------------------

describe("groupItemsByEpic", () => {
  it("groups items under their root epic ancestor", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "task-1",
        title: "Auth login",
        parentChain: [
          { id: "epic-1", title: "Authentication", level: "epic" },
          { id: "feat-1", title: "Login Flow", level: "feature" },
        ],
      }),
      makeItem({
        id: "task-2",
        title: "Auth signup",
        parentChain: [
          { id: "epic-1", title: "Authentication", level: "epic" },
          { id: "feat-2", title: "Signup Flow", level: "feature" },
        ],
      }),
    ];

    const grouped = groupItemsByEpic(items);
    expect(grouped.size).toBe(1);
    expect(grouped.get("Authentication")).toHaveLength(2);
  });

  it("puts items without epic parent under '(Ungrouped)' key", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "task-1", title: "Orphan task", parentChain: [] }),
    ];

    const grouped = groupItemsByEpic(items);
    expect(grouped.has("(Ungrouped)")).toBe(true);
    expect(grouped.get("(Ungrouped)")).toHaveLength(1);
  });

  it("groups multiple epics separately", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "task-1",
        title: "Auth task",
        parentChain: [{ id: "epic-1", title: "Auth", level: "epic" }],
      }),
      makeItem({
        id: "task-2",
        title: "UI task",
        parentChain: [{ id: "epic-2", title: "UI Polish", level: "epic" }],
      }),
    ];

    const grouped = groupItemsByEpic(items);
    expect(grouped.size).toBe(2);
    expect(grouped.has("Auth")).toBe(true);
    expect(grouped.has("UI Polish")).toBe(true);
  });

  it("returns empty map for empty items array", () => {
    const grouped = groupItemsByEpic([]);
    expect(grouped.size).toBe(0);
  });

  it("uses feature title when no epic in chain", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "task-1",
        title: "Some task",
        parentChain: [{ id: "feat-1", title: "Feature X", level: "feature" }],
      }),
    ];

    const grouped = groupItemsByEpic(items);
    expect(grouped.has("(Ungrouped)")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractBreakingChanges
// ---------------------------------------------------------------------------

describe("extractBreakingChanges", () => {
  it("returns only items with breakingChange=true", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", title: "Breaking task", breakingChange: true }),
      makeItem({ id: "t2", title: "Normal task", breakingChange: false }),
      makeItem({ id: "t3", title: "No flag task" }),
    ];

    const breaking = extractBreakingChanges(items);
    expect(breaking).toHaveLength(1);
    expect(breaking[0].id).toBe("t1");
  });

  it("returns empty array when no breaking changes exist", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", title: "Normal task" }),
    ];

    const breaking = extractBreakingChanges(items);
    expect(breaking).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractMajorChanges
// ---------------------------------------------------------------------------

describe("extractMajorChanges", () => {
  it("returns only items with changeSignificance=major", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", title: "Major change", changeSignificance: "major" }),
      makeItem({ id: "t2", title: "Minor change", changeSignificance: "minor" }),
      makeItem({ id: "t3", title: "Patch change", changeSignificance: "patch" }),
      makeItem({ id: "t4", title: "No significance" }),
    ];

    const major = extractMajorChanges(items);
    expect(major).toHaveLength(1);
    expect(major[0].id).toBe("t1");
  });

  it("returns empty array when no major changes exist", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", changeSignificance: "minor" }),
    ];

    const major = extractMajorChanges(items);
    expect(major).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// renderSummarySection
// ---------------------------------------------------------------------------

describe("renderSummarySection", () => {
  it("includes branch name and item count", () => {
    const record = makeRecord({
      branch: "feature/auth-system",
      items: [makeItem(), makeItem({ id: "t2" })],
    });

    const section = renderSummarySection(record);
    expect(section).toContain("feature/auth-system");
    expect(section).toContain("2");
  });

  it("includes epic summary counts when available", () => {
    const record = makeRecord({
      epicSummaries: [
        { id: "epic-1", title: "Auth", completedCount: 5 },
        { id: "epic-2", title: "UI", completedCount: 3 },
      ],
    });

    const section = renderSummarySection(record);
    expect(section).toContain("Auth");
    expect(section).toContain("UI");
  });

  it("handles empty record gracefully", () => {
    const record = makeRecord({ items: [], epicSummaries: [] });
    const section = renderSummarySection(record);
    expect(section).toContain("0");
  });
});

// ---------------------------------------------------------------------------
// renderEpicSection
// ---------------------------------------------------------------------------

describe("renderEpicSection", () => {
  it("renders epic heading with items grouped by feature", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "task-1",
        title: "Login form",
        level: "task",
        parentChain: [
          { id: "epic-1", title: "Auth", level: "epic" },
          { id: "feat-1", title: "Login Flow", level: "feature" },
        ],
      }),
      makeItem({
        id: "task-2",
        title: "Signup form",
        level: "task",
        parentChain: [
          { id: "epic-1", title: "Auth", level: "epic" },
          { id: "feat-2", title: "Signup Flow", level: "feature" },
        ],
      }),
    ];

    const section = renderEpicSection("Auth", items);
    expect(section).toContain("### Auth");
    expect(section).toContain("Login Flow");
    expect(section).toContain("Login form");
    expect(section).toContain("Signup Flow");
    expect(section).toContain("Signup form");
  });

  it("renders items without feature parent in '(Other)' group", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "task-1",
        title: "Standalone task",
        level: "task",
        parentChain: [{ id: "epic-1", title: "Infra", level: "epic" }],
      }),
    ];

    const section = renderEpicSection("Infra", items);
    expect(section).toContain("### Infra");
    expect(section).toContain("Standalone task");
  });

  it("shows level for non-task items", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "feat-1",
        title: "Completed feature",
        level: "feature",
        parentChain: [{ id: "epic-1", title: "Auth", level: "epic" }],
      }),
    ];

    const section = renderEpicSection("Auth", items);
    expect(section).toContain("feature");
    expect(section).toContain("Completed feature");
  });
});

// ---------------------------------------------------------------------------
// renderBreakingChangesSection
// ---------------------------------------------------------------------------

describe("renderBreakingChangesSection", () => {
  it("renders warning indicator for each breaking change", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "Remove legacy API",
        breakingChange: true,
        description: "Removes the v1 API endpoints",
      }),
    ];

    const section = renderBreakingChangesSection(items);
    expect(section).toContain("⚠️");
    expect(section).toContain("Remove legacy API");
  });

  it("includes description when available", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "Breaking task",
        breakingChange: true,
        description: "This removes old behavior",
      }),
    ];

    const section = renderBreakingChangesSection(items);
    expect(section).toContain("This removes old behavior");
  });

  it("returns empty string when no breaking changes", () => {
    const section = renderBreakingChangesSection([]);
    expect(section).toBe("");
  });
});

// ---------------------------------------------------------------------------
// renderMajorChangesSection
// ---------------------------------------------------------------------------

describe("renderMajorChangesSection", () => {
  it("renders major change items with significance indicator", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "New auth system",
        changeSignificance: "major",
        description: "Complete auth rewrite",
      }),
    ];

    const section = renderMajorChangesSection(items);
    expect(section).toContain("New auth system");
  });

  it("includes description when available", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "Major task",
        changeSignificance: "major",
        description: "Detailed description of the change",
      }),
    ];

    const section = renderMajorChangesSection(items);
    expect(section).toContain("Detailed description of the change");
  });

  it("returns empty string when no major changes", () => {
    const section = renderMajorChangesSection([]);
    expect(section).toBe("");
  });
});

// ---------------------------------------------------------------------------
// renderPRMarkdownFromRecord (full integration)
// ---------------------------------------------------------------------------

describe("renderPRMarkdownFromRecord", () => {
  it("generates complete markdown with all sections", () => {
    const record = makeRecord({
      branch: "feature/auth-system",
      items: [
        makeItem({
          id: "task-1",
          title: "Login form",
          level: "task",
          parentChain: [
            { id: "epic-1", title: "Authentication", level: "epic" },
            { id: "feat-1", title: "Login Flow", level: "feature" },
          ],
        }),
        makeItem({
          id: "task-2",
          title: "Remove v1 endpoints",
          level: "task",
          breakingChange: true,
          changeSignificance: "major",
          description: "Removes deprecated v1 API",
          parentChain: [
            { id: "epic-2", title: "API Migration", level: "epic" },
            { id: "feat-2", title: "Endpoint Cleanup", level: "feature" },
          ],
        }),
      ],
      epicSummaries: [
        { id: "epic-1", title: "Authentication", completedCount: 1 },
        { id: "epic-2", title: "API Migration", completedCount: 1 },
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);

    // Summary section
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("feature/auth-system");

    // Epic/feature sections
    expect(markdown).toContain("### Authentication");
    expect(markdown).toContain("Login form");
    expect(markdown).toContain("### API Migration");
    expect(markdown).toContain("Remove v1 endpoints");

    // Breaking changes section
    expect(markdown).toContain("## Breaking Changes");
    expect(markdown).toContain("⚠️");
    expect(markdown).toContain("Remove v1 endpoints");

    // Major changes section
    expect(markdown).toContain("## Major Changes");
    expect(markdown).toContain("Remove v1 endpoints");
    expect(markdown).toContain("Removes deprecated v1 API");
  });

  it("omits breaking changes section when none exist", () => {
    const record = makeRecord({
      items: [makeItem({ id: "t1", title: "Normal task" })],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    expect(markdown).not.toContain("## Breaking Changes");
  });

  it("omits major changes section when none exist", () => {
    const record = makeRecord({
      items: [makeItem({ id: "t1", title: "Normal task" })],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    expect(markdown).not.toContain("## Major Changes");
  });

  it("handles empty record with no items", () => {
    const record = makeRecord({ items: [], epicSummaries: [] });

    const markdown = renderPRMarkdownFromRecord(record);
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("No completed work items");
  });

  it("sorts epics alphabetically", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Zebra task",
          parentChain: [{ id: "e2", title: "Zebra Epic", level: "epic" }],
        }),
        makeItem({
          id: "t2",
          title: "Alpha task",
          parentChain: [{ id: "e1", title: "Alpha Epic", level: "epic" }],
        }),
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    const alphaIdx = markdown.indexOf("### Alpha Epic");
    const zebraIdx = markdown.indexOf("### Zebra Epic");
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(zebraIdx).toBeGreaterThan(-1);
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });

  it("includes acceptance criteria for breaking changes when available", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Breaking change",
          breakingChange: true,
          acceptanceCriteria: ["Consumers must update their imports"],
        }),
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    expect(markdown).toContain("Consumers must update their imports");
  });

  it("renders multiple items under same feature", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Task A",
          parentChain: [
            { id: "e1", title: "Epic", level: "epic" },
            { id: "f1", title: "Feature X", level: "feature" },
          ],
        }),
        makeItem({
          id: "t2",
          title: "Task B",
          parentChain: [
            { id: "e1", title: "Epic", level: "epic" },
            { id: "f1", title: "Feature X", level: "feature" },
          ],
        }),
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    // Feature X should appear once as a heading but have both tasks
    expect(markdown).toContain("Task A");
    expect(markdown).toContain("Task B");
    expect(markdown).toContain("Feature X");
  });

  it("produces stable output on repeated calls", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Task A",
          parentChain: [{ id: "e1", title: "Epic B", level: "epic" }],
        }),
        makeItem({
          id: "t2",
          title: "Task B",
          parentChain: [{ id: "e2", title: "Epic A", level: "epic" }],
        }),
      ],
    });

    const first = renderPRMarkdownFromRecord(record);
    const second = renderPRMarkdownFromRecord(record);
    expect(first).toBe(second);
  });

  it("includes priority and tags for high-priority items", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Critical task",
          priority: "high",
          tags: ["security", "auth"],
          changeSignificance: "major",
          parentChain: [{ id: "e1", title: "Security", level: "epic" }],
        }),
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    expect(markdown).toContain("Critical task");
    // Tags and priority should be visible in the major changes section
    expect(markdown).toContain("high");
  });

  it("ends with a trailing newline", () => {
    const record = makeRecord();
    const markdown = renderPRMarkdownFromRecord(record);
    expect(markdown.endsWith("\n")).toBe(true);
  });
});
