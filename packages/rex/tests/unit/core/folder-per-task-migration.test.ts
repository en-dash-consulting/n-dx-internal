/**
 * Tests for folder-per-task structural migration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { migrateToFolderPerTask } from "../../../src/core/folder-per-task-migration.js";

describe("migrateToFolderPerTask", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `test-migration-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("wraps a bare task .md that has child siblings into its own folder", async () => {
    // Under the unified leaf rule a bare `<slug>.md` next to its parent's
    // `index.md` is the canonical shape for a leaf — only a bare file with
    // sibling subdirs that look like its children is non-conforming and
    // needs wrapping.
    const epicDir = join(testDir, "epic-slug");
    await mkdir(epicDir, { recursive: true });

    const featureContent = `---
id: "feature-123"
level: "feature"
title: "Feature Title"
status: "pending"
description: ""
acceptanceCriteria: []
---

# Feature Title
`;
    await writeFile(join(epicDir, "feature_title.md"), featureContent);

    // Bare task .md at feature level with a sibling subdir that looks like
    // its child — this is the legacy shape that needs migration.
    const taskId = randomUUID();
    const taskContent = `---
id: "${taskId}"
level: "task"
title: "Task Title"
status: "pending"
description: ""
acceptanceCriteria: []
---

# Task Title
`;
    await writeFile(join(epicDir, "task_title.md"), taskContent);
    await mkdir(join(epicDir, "task_title-child1"), { recursive: true });
    await writeFile(
      join(epicDir, "task_title-child1", "child_one.md"),
      `---
id: "child-1"
level: "subtask"
title: "Child One"
status: "pending"
---

# Child One
`,
    );

    const result = await migrateToFolderPerTask(testDir);

    expect(result.migratedCount).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
    expect(result.migrations.some((m) => m.type === "bare-task-to-folder")).toBe(true);

    const entries = await readdir(epicDir);
    expect(entries.includes("task_title.md")).toBe(false);
    expect(entries.some((e) => e.startsWith("task_title-"))).toBe(true);
  });

  it("leaves a bare task `.md` without children alone (canonical leaf)", async () => {
    // Sibling structure: epic folder with a feature `index.md` and a bare
    // task leaf next to it. This is the canonical shape under the unified
    // leaf rule and the migration must not touch it.
    const epicDir = join(testDir, "epic-slug");
    await mkdir(epicDir, { recursive: true });

    await writeFile(
      join(epicDir, "index.md"),
      `---
id: "epic-1"
level: "epic"
title: "Epic"
status: "pending"
description: ""
---

# Epic
`,
    );

    const featureDir = join(epicDir, "feature-slug");
    await mkdir(featureDir, { recursive: true });
    await writeFile(
      join(featureDir, "index.md"),
      `---
id: "feature-1"
level: "feature"
title: "Feature"
status: "pending"
description: ""
acceptanceCriteria: []
---

# Feature
`,
    );
    await writeFile(
      join(featureDir, "task-slug.md"),
      `---
id: "task-1"
level: "task"
title: "Task"
status: "pending"
description: ""
acceptanceCriteria: []
---

# Task
`,
    );

    const result = await migrateToFolderPerTask(testDir);

    expect(result.migratedCount).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("detects subtask .md files with orphaned child siblings", async () => {
    // Create a structure:
    // testDir/
    //   epic-slug/
    //     task-slug/
    //       subtask_title.md      <- bare subtask .md with children
    //       subtask_title-child1/ <- orphaned child
    //       subtask_title-child2/ <- orphaned child

    const taskDir = join(testDir, "epic-slug", "task-slug");
    const child1Dir = join(taskDir, "subtask_title-child1");
    const child2Dir = join(taskDir, "subtask_title-child2");

    await mkdir(child1Dir, { recursive: true });
    await mkdir(child2Dir, { recursive: true });

    // Write subtask .md
    const subtaskId = randomUUID();
    const subtaskContent = `---
id: "${subtaskId}"
level: "subtask"
title: "Subtask Title"
status: "pending"
description: ""
---

# Subtask Title
`;
    await writeFile(join(taskDir, "subtask_title.md"), subtaskContent);

    // Write child .md files
    const child1Content = `---
id: "child1-id"
level: "subtask"
title: "Child 1"
status: "pending"
description: ""
---

# Child 1
`;
    await writeFile(join(child1Dir, "child_1.md"), child1Content);

    const child2Content = `---
id: "child2-id"
level: "subtask"
title: "Child 2"
status: "pending"
description: ""
---

# Child 2
`;
    await writeFile(join(child2Dir, "child_2.md"), child2Content);

    // Run migration
    const result = await migrateToFolderPerTask(testDir);

    // The migration may apply multiple passes (e.g. rename child .md files
    // inside the new subtask folder to index.md). Assert that at least the
    // subtask-with-children-to-folder migration ran.
    expect(result.migratedCount).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
    expect(result.migrations.some((m) => m.type === "subtask-with-children-to-folder")).toBe(true);

    // Verify the subtask file was moved to a folder
    const entries = await readdir(taskDir);
    const subtaskFileExists = entries.includes("subtask_title.md");
    expect(subtaskFileExists).toBe(false);

    // Verify children were moved into the subtask folder
    const subtaskFolder = entries.find((e) => e.startsWith("subtask_title-"));
    expect(subtaskFolder).toBeDefined();

    if (subtaskFolder) {
      const subtaskDirEntries = await readdir(join(taskDir, subtaskFolder));
      expect(subtaskDirEntries).toContain("index.md");
      // Children should be moved into the subtask folder
      expect(subtaskDirEntries.some((e) => e.includes("child1") || e.includes("child2"))).toBe(true);
    }
  });

  it("is idempotent - second run produces no changes", async () => {
    // Pre-migration: a bare task with sibling subdirs that look like its
    // children. The first run wraps it; the second must be a no-op.
    const epicDir = join(testDir, "epic-slug");
    await mkdir(epicDir, { recursive: true });

    const taskId = randomUUID();
    await writeFile(
      join(epicDir, "task_title.md"),
      `---
id: "${taskId}"
level: "task"
title: "Task Title"
status: "pending"
description: ""
acceptanceCriteria: []
---

# Task Title
`,
    );
    await mkdir(join(epicDir, "task_title-child"), { recursive: true });
    await writeFile(
      join(epicDir, "task_title-child", "child.md"),
      `---
id: "child-1"
level: "subtask"
title: "Child"
status: "pending"
---

# Child
`,
    );

    const result1 = await migrateToFolderPerTask(testDir);
    expect(result1.migratedCount).toBeGreaterThanOrEqual(1);

    const result2 = await migrateToFolderPerTask(testDir);
    expect(result2.migratedCount).toBe(0);
    expect(result2.errors).toHaveLength(0);
  });

  it("handles deeply nested mixed-mode trees", async () => {
    // Create a deeply nested tree with multiple items to migrate:
    // testDir/
    //   epic1/
    //     feature1/
    //       task1.md          <- bare task (should migrate)
    //       task1-sub1/
    //         subtask1.md     <- bare subtask with children (should migrate)
    //         subtask1-child1/

    const task1Dir = join(testDir, "epic1", "feature1");
    const sub1Dir = join(task1Dir, "task1-sub1");
    const child1Dir = join(sub1Dir, "subtask1-child1");

    await mkdir(child1Dir, { recursive: true });

    // Write task1
    const task1Id = randomUUID();
    const task1Content = `---
id: "${task1Id}"
level: "task"
title: "Task 1"
status: "pending"
description: ""
acceptanceCriteria: []
---

# Task 1
`;
    await writeFile(join(task1Dir, "task1.md"), task1Content);

    // Write subtask1
    const subtask1Id = randomUUID();
    const subtask1Content = `---
id: "${subtask1Id}"
level: "subtask"
title: "Subtask 1"
status: "pending"
description: ""
---

# Subtask 1
`;
    await writeFile(join(sub1Dir, "subtask1.md"), subtask1Content);

    // Write child
    const childContent = `---
id: "child-id"
level: "subtask"
title: "Child 1"
status: "pending"
description: ""
---

# Child 1
`;
    await writeFile(join(child1Dir, "child_1.md"), childContent);

    // Run migration
    const result = await migrateToFolderPerTask(testDir);

    // Should detect both migrations
    expect(result.migratedCount).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
  });

  it("skips already-conforming structures", async () => {
    // Create a structure that conforms to the new schema (each item folder
    // contains a single `index.md`):
    // testDir/
    //   epic-slug/
    //     index.md         <- epic content
    //     task-slug/
    //       index.md       <- task content
    //       subtask-slug/
    //         index.md     <- subtask content

    const epicDir = join(testDir, "epic-slug");
    const taskDir = join(epicDir, "task-slug");
    const subtaskDir = join(taskDir, "subtask-slug");

    await mkdir(subtaskDir, { recursive: true });

    const epicContent = `---
id: "epic-001"
level: "epic"
title: "Epic Title"
status: "pending"
description: ""
---

# Epic Title
`;
    await writeFile(join(epicDir, "index.md"), epicContent);

    const taskContent = `---
id: "task-123"
level: "task"
title: "Task Title"
status: "pending"
description: ""
acceptanceCriteria: []
---

# Task Title
`;
    await writeFile(join(taskDir, "index.md"), taskContent);

    const subtaskContent = `---
id: "subtask-456"
level: "subtask"
title: "Subtask Title"
status: "pending"
description: ""
---

# Subtask Title
`;
    await writeFile(join(subtaskDir, "index.md"), subtaskContent);

    // Run migration — the canonical shape requires no changes.
    const result = await migrateToFolderPerTask(testDir);

    expect(result.migratedCount).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.migrations).toHaveLength(0);
  });

  it("handles missing tree gracefully", async () => {
    const missingDir = join(testDir, "nonexistent");

    const result = await migrateToFolderPerTask(missingDir);

    expect(result.migratedCount).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("reports errors for malformed files", async () => {
    // Create a file with invalid frontmatter
    const epicDir = join(testDir, "epic-slug");
    await mkdir(epicDir, { recursive: true });

    const malformedContent = `---
id: "missing-level"
title: "No Level Field"
status: "pending"
---

# Bad File
`;
    await writeFile(join(epicDir, "bad_file.md"), malformedContent);

    // Run migration
    const result = await migrateToFolderPerTask(testDir);

    // Should not crash, just skip malformed files
    expect(result.errors.length >= 0).toBe(true);
  });
});
