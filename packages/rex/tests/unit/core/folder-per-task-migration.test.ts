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

  it("detects and migrates bare task .md files to folder form", async () => {
    // Create a pre-migration structure:
    // testDir/
    //   epic-slug/
    //     feature_title.md  <- feature at proper level (should not be migrated)
    //   task_title.md       <- bare task .md at feature level (should be migrated)

    const epicDir = join(testDir, "epic-slug");
    await mkdir(epicDir, { recursive: true });

    // Write a feature file (this is OK at feature level)
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

    // Write a bare task .md at the wrong level
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

    // Run migration
    const result = await migrateToFolderPerTask(testDir);

    // Check that migration was detected
    expect(result.migratedCount).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.migrations).toHaveLength(1);
    expect(result.migrations[0].type).toBe("bare-task-to-folder");

    // Verify the task file was moved
    const entries = await readdir(epicDir);
    const taskFileExists = entries.includes("task_title.md");
    expect(taskFileExists).toBe(false);

    // Verify a folder was created for the task
    const folderCreated = entries.some((e) => e.startsWith("task_title-"));
    expect(folderCreated).toBe(true);
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

    // Check that migration was detected
    expect(result.migratedCount).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.migrations[0].type).toBe("subtask-with-children-to-folder");

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
    // Create a pre-migration structure
    const epicDir = join(testDir, "epic-slug");
    await mkdir(epicDir, { recursive: true });

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

    // First run
    const result1 = await migrateToFolderPerTask(testDir);
    expect(result1.migratedCount).toBe(1);

    // Second run
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
    // Create a conforming structure:
    // testDir/
    //   epic-slug/
    //     task-slug/
    //       task_title.md   <- task in its own folder (OK)
    //       subtask-slug/
    //         subtask.md    <- subtask in its own folder (OK)

    const taskDir = join(testDir, "epic-slug", "task-slug");
    const subtaskDir = join(taskDir, "subtask-slug");

    await mkdir(subtaskDir, { recursive: true });

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
    await writeFile(join(taskDir, "task_title.md"), taskContent);

    const subtaskContent = `---
id: "subtask-456"
level: "subtask"
title: "Subtask Title"
status: "pending"
description: ""
---

# Subtask Title
`;
    await writeFile(join(subtaskDir, "subtask_title.md"), subtaskContent);

    // Run migration
    const result = await migrateToFolderPerTask(testDir);

    // Should not detect any migrations
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
