import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";

/**
 * Create a minimal fixture project with .rex/ and empty PRD.
 */
async function writeFixtureProject(
  dir: string,
  items: PRDItem[] = [],
): Promise<void> {
  await mkdir(join(dir, ".rex"), { recursive: true });

  await writeFile(
    join(dir, ".rex", "config.json"),
    JSON.stringify({
      schema: "rex/v1",
      project: "test-project",
      adapter: "file",
    }),
    "utf-8",
  );

  await writeFile(
    join(dir, ".rex", "prd.json"),
    JSON.stringify({
      schema: "rex/v1",
      title: "test-project",
      items,
    }),
    "utf-8",
  );
}

async function readPrd(dir: string): Promise<PRDDocument> {
  const raw = await readFile(join(dir, ".rex", "prd.json"), "utf-8");
  return JSON.parse(raw) as PRDDocument;
}

async function readLog(dir: string): Promise<string[]> {
  try {
    const raw = await readFile(join(dir, ".rex", "execution-log.jsonl"), "utf-8");
    return raw.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("createItemsFromRecommendations", () => {
  let tmpDir: string;
  let createItemsFromRecommendations: typeof import("../../../src/recommend/create-from-recommendations.js")["createItemsFromRecommendations"];
  let resolveStore: typeof import("../../../src/store/index.js")["resolveStore"];

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@n-dx/llm-client", () => ({
      PROJECT_DIRS: {
        REX: ".rex",
        SOURCEVISION: ".sourcevision",
      },
      formatUsage: () => "",
      toCanonicalJSON: (value: unknown) => JSON.stringify(value, null, 2),
      result: () => {},
      info: () => {},
      setQuiet: () => {},
      isQuiet: () => false,
    }));

    ({ createItemsFromRecommendations } = await import(
      "../../../src/recommend/create-from-recommendations.js"
    ));
    ({ resolveStore } = await import("../../../src/store/index.js"));

    tmpDir = await mkdtemp(join(tmpdir(), "rex-create-rec-test-"));
  });

  afterEach(async () => {
    vi.doUnmock("@n-dx/llm-client");
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Empty input ─────────────────────────────────────────────────────

  it("returns empty result for zero recommendations", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, []);

    expect(result.created).toHaveLength(0);
    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(0);
  });

  // ── Basic creation ──────────────────────────────────────────────────

  it("creates a single epic from a recommendation", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "Improve auth system",
        level: "epic",
        description: "Multiple auth issues found",
        priority: "critical",
        source: "sourcevision",
      },
    ]);

    expect(result.created).toHaveLength(1);
    expect(result.created[0].title).toBe("Improve auth system");
    expect(result.created[0].level).toBe("epic");

    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].title).toBe("Improve auth system");
    expect(doc.items[0].status).toBe("pending");
    expect(doc.items[0].priority).toBe("critical");
    expect(doc.items[0].source).toBe("sourcevision");
  });

  it("creates multiple items atomically", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "Address auth issues",
        level: "epic",
        description: "Auth findings",
        priority: "critical",
        source: "sourcevision",
      },
      {
        title: "Address perf issues",
        level: "epic",
        description: "Perf findings",
        priority: "high",
        source: "sourcevision",
      },
      {
        title: "Address security issues",
        level: "epic",
        description: "Security findings",
        priority: "medium",
        source: "sourcevision",
      },
    ]);

    expect(result.created).toHaveLength(3);

    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(3);
    expect(doc.items[0].title).toBe("Address auth issues");
    expect(doc.items[1].title).toBe("Address perf issues");
    expect(doc.items[2].title).toBe("Address security issues");
  });

  // ── Metadata preservation ───────────────────────────────────────────

  it("preserves recommendation metadata and quality scores on created items", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "Address auth issues",
        level: "epic",
        description: "Auth findings",
        priority: "critical",
        source: "sourcevision",
        tags: ["auth", "security"],
        meta: {
          findingHashes: ["abc123", "def456"],
          category: "auth",
          severityDistribution: { critical: 1, warning: 1 },
          findingCount: 2,
        },
      },
    ]);

    const doc = await readPrd(tmpDir);
    const item = doc.items[0];

    expect(item.source).toBe("sourcevision");
    expect(item.priority).toBe("critical");
    expect(item.tags).toEqual(["auth", "security"]);

    // Recommendation metadata
    const meta = item.recommendationMeta as {
      findingHashes: string[];
      category: string;
      severityDistribution: Record<string, number>;
      findingCount: number;
    };
    expect(meta).toBeDefined();
    expect(meta.findingHashes).toEqual(["abc123", "def456"]);
    expect(meta.category).toBe("auth");
    expect(meta.severityDistribution).toEqual({ critical: 1, warning: 1 });
    expect(meta.findingCount).toBe(2);
  });

  it("omits recommendationMeta when no meta is provided", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "Simple recommendation",
        level: "epic",
        description: "No meta",
        priority: "low",
        source: "manual",
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items[0].recommendationMeta).toBeUndefined();
  });

  // ── Parent-child creation ───────────────────────────────────────────

  it("creates items under an existing parent", async () => {
    const epicId = "existing-epic-id";
    await writeFixtureProject(tmpDir, [
      {
        id: epicId,
        title: "Existing Epic",
        status: "pending",
        level: "epic",
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "New feature under epic",
        level: "feature",
        description: "A feature recommendation",
        priority: "high",
        source: "sourcevision",
        parentId: epicId,
      },
    ]);

    expect(result.created).toHaveLength(1);
    expect(result.created[0].parentId).toBe(epicId);

    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(1); // Still one root item
    expect(doc.items[0].children).toHaveLength(1);
    expect(doc.items[0].children![0].title).toBe("New feature under epic");
  });

  // ── Validation: parent not found ────────────────────────────────────

  it("throws when parent ID does not exist", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Orphan feature",
          level: "feature",
          description: "No parent exists",
          priority: "high",
          source: "sourcevision",
          parentId: "nonexistent-parent",
        },
      ]),
    ).rejects.toThrow(/Parent "nonexistent-parent" not found/);

    // Verify nothing was created (atomic rollback)
    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(0);
  });

  // ── Validation: level hierarchy ─────────────────────────────────────

  it("throws when child level is invalid for the parent level", async () => {
    const taskId = "existing-task-id";
    await writeFixtureProject(tmpDir, [
      {
        id: "epic-1",
        title: "Epic",
        status: "pending",
        level: "epic",
        children: [
          {
            id: "feature-1",
            title: "Feature",
            status: "pending",
            level: "feature",
            children: [
              {
                id: taskId,
                title: "Task",
                status: "pending",
                level: "task",
              },
            ],
          },
        ],
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    // Try to add a feature under a task (invalid per hierarchy)
    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Feature under task",
          level: "feature",
          description: "Invalid placement",
          priority: "high",
          source: "sourcevision",
          parentId: taskId,
        },
      ]),
    ).rejects.toThrow(/must be a child of a epic/);
  });

  it("throws when a subtask is added without a parent", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Subtask at root",
          level: "subtask",
          description: "Cannot be root",
          priority: "low",
          source: "sourcevision",
        },
      ]),
    ).rejects.toThrow(/requires a parent/);
  });

  it("allows features at root level (recommendation workflow)", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    // Features from sourcevision recommendations are typically added at root
    const result = await createItemsFromRecommendations(store, [
      {
        title: "Address auth issues (3 findings)",
        level: "feature",
        description: "- Auth finding A\n- Auth finding B",
        priority: "critical",
        source: "sourcevision",
      },
    ]);

    expect(result.created).toHaveLength(1);
    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].level).toBe("feature");
  });

  // ── Atomicity ───────────────────────────────────────────────────────

  it("creates zero items when validation fails for any item in the batch", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    // Mix of valid and invalid items
    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Valid epic",
          level: "epic",
          description: "This is fine",
          priority: "high",
          source: "sourcevision",
        },
        {
          title: "Invalid subtask at root",
          level: "subtask",
          description: "This should fail",
          priority: "low",
          source: "sourcevision",
        },
      ]),
    ).rejects.toThrow(/requires a parent/);

    // Verify NOTHING was created — atomic rollback
    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(0);
  });

  // ── Logging ─────────────────────────────────────────────────────────

  it("logs item_added events for each created item", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "Auth epic",
        level: "epic",
        description: "Auth findings",
        priority: "critical",
        source: "sourcevision",
      },
      {
        title: "Perf epic",
        level: "epic",
        description: "Perf findings",
        priority: "high",
        source: "sourcevision",
      },
    ]);

    const logLines = await readLog(tmpDir);
    expect(logLines).toHaveLength(2);

    const entries = logLines.map((l) => JSON.parse(l));
    expect(entries[0].event).toBe("item_added");
    expect(entries[0].detail).toContain("Auth epic");
    expect(entries[0].detail).toContain("from recommendation");
    expect(entries[1].event).toBe("item_added");
    expect(entries[1].detail).toContain("Perf epic");
  });

  // ── Preserves existing items ────────────────────────────────────────

  it("preserves existing PRD items when adding recommendations", async () => {
    await writeFixtureProject(tmpDir, [
      {
        id: "existing-1",
        title: "Existing Epic",
        status: "in_progress",
        level: "epic",
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "New recommendation",
        level: "epic",
        description: "From sourcevision",
        priority: "high",
        source: "sourcevision",
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(2);
    expect(doc.items[0].id).toBe("existing-1");
    expect(doc.items[0].title).toBe("Existing Epic");
    expect(doc.items[1].title).toBe("New recommendation");
  });

  // ── Return value ────────────────────────────────────────────────────

  it("returns created item IDs that match persisted items", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "Test item",
        level: "epic",
        description: "Test",
        priority: "medium",
        source: "test",
      },
    ]);

    expect(result.created).toHaveLength(1);
    const doc = await readPrd(tmpDir);
    expect(doc.items[0].id).toBe(result.created[0].id);
  });

  // ── Tags ────────────────────────────────────────────────────────────

  it("applies tags when provided", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "Tagged item",
        level: "epic",
        description: "Has tags",
        priority: "low",
        source: "sourcevision",
        tags: ["auth", "critical-fix"],
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items[0].tags).toEqual(["auth", "critical-fix"]);
  });

  it("omits tags field when no tags are provided", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "No tags",
        level: "epic",
        description: "No tags here",
        priority: "low",
        source: "sourcevision",
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items[0].tags).toBeUndefined();
  });
});
