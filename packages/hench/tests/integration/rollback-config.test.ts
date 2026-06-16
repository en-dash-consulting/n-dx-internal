import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig, saveConfig, loadConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";

const execAsync = promisify(execCb);

/**
 * Working-tree preservation tests for the deprecated rollbackOnFailure config key.
 *
 * Automatic git rollback on run failure has been removed. The rollbackOnFailure
 * config key and --no-rollback flag are now no-ops. These tests assert that:
 *
 *  1. Working tree is always preserved on failure regardless of rollbackOnFailure
 *  2. Setting rollbackOnFailure=true in config has no effect (deprecated no-op)
 *  3. Setting rollbackOnFailure=false in config has no effect (always no-op)
 *  4. yes=true has no effect on working-tree preservation (never did rollback anyway)
 *  5. PRD task status reset still works correctly on failure (unrelated to rollback)
 */

async function setupGitRepo(dir: string): Promise<void> {
  await execAsync("git init", { cwd: dir });
  await execAsync("git config user.email test@test.com", { cwd: dir });
  await execAsync("git config user.name Test", { cwd: dir });
}

async function makeInitialCommit(dir: string, file: string, content: string): Promise<void> {
  await writeFile(join(dir, file), content, "utf-8");
  await execAsync("git add .", { cwd: dir });
  await execAsync('git commit -m "initial"', { cwd: dir });
}

function buildMinimalRun(status: RunRecord["status"]): RunRecord {
  return {
    id: randomUUID(),
    taskId: "task-1",
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    status,
    turns: 3,
    tokenUsage: { input: 100, output: 50 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
  };
}

describe("rollbackOnFailure config key (deprecated — no-op)", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-rollback-cfg-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await setupGitRepo(projectDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("preserves working tree when config.rollbackOnFailure=false (no-op, was never rollback)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const config = await loadConfig(henchDir);
    await saveConfig(henchDir, { ...config, rollbackOnFailure: false });

    const originalContent = "console.log('original');\n";
    const modifiedContent = "console.log('modified by agent');\n";
    await makeInitialCommit(projectDir, "src.ts", originalContent);
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("failed");

    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: false });

    const fileContent = await readFile(join(projectDir, "src.ts"), "utf-8");
    expect(fileContent).toBe(modifiedContent);
  });

  it("preserves working tree when rollbackOnFailure=true (deprecated no-op)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modifiedContent = "export const x = 999;\n";
    await makeInitialCommit(projectDir, "lib.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "lib.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("failed");

    // rollbackOnFailure=true is now a deprecated no-op — working tree must not change
    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: true });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(modifiedContent);
  });

  it("preserves working tree when rollbackOnFailure is omitted (always no-op)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modifiedContent = "export const a = 999;\n";
    await makeInitialCommit(projectDir, "lib.ts", "export const a = 1;\n");
    await writeFile(join(projectDir, "lib.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("failed");

    // No rollbackOnFailure argument — default behavior preserves the working tree
    await finalizeRun({ run, henchDir, projectDir });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(modifiedContent);
  });
});

describe("non-TTY / CI environment working-tree preservation", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-ci-rollback-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await setupGitRepo(projectDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("preserves working tree in non-TTY environment (CI mode)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    // In test environments process.stdin.isTTY is always false (non-interactive).
    // Rollback has been removed; this test verifies finalization still completes
    // cleanly in CI without hanging on any interactive prompt.
    expect(process.stdin.isTTY).toBeFalsy();

    const modifiedContent = "export const ci = false;\n";
    await makeInitialCommit(projectDir, "ci.ts", "export const ci = true;\n");
    await writeFile(join(projectDir, "ci.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("failed");

    // Should complete without hanging on a readline prompt
    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: true });

    const content = await readFile(join(projectDir, "ci.ts"), "utf-8");
    expect(content).toBe(modifiedContent);
  });

  it("preserves working tree when yes=true (--yes flag)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modifiedContent = "export const prompted = true;\n";
    await makeInitialCommit(projectDir, "flag.ts", "export const prompted = false;\n");
    await writeFile(join(projectDir, "flag.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("failed");

    // yes=true — working tree must still be preserved (rollback is gone)
    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: true, yes: true });

    const content = await readFile(join(projectDir, "flag.ts"), "utf-8");
    expect(content).toBe(modifiedContent);
  });

  it("preserves working tree and resets PRD task status on failure", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modifiedContent = "export const kept = false;\n";
    await makeInitialCommit(projectDir, "kept.ts", "export const kept = true;\n");
    await writeFile(join(projectDir, "kept.ts"), modifiedContent, "utf-8");

    // Build a minimal mock PRD store to verify PRD status reset
    let currentStatus: string = "in_progress";
    const store = {
      async loadDocument() { return { version: 1, title: "Test", items: [] }; },
      async saveDocument() {},
      async getItem(id: string) {
        if (id !== "task-1") return null;
        return { id: "task-1", title: "Test task", status: currentStatus, level: "task" };
      },
      async addItem() {},
      async updateItem(_id: string, updates: Record<string, unknown>) {
        if (updates.status) currentStatus = updates.status as string;
      },
      async removeItem() {},
      async loadConfig() { return {}; },
      async saveConfig() {},
      async appendLog() {},
      async readLog() { return []; },
      async loadWorkflow() { return ""; },
      async saveWorkflow() {},
      async withTransaction<T>(fn: (doc: unknown) => Promise<T>) { return fn({ version: 1, title: "Test", items: [] }); },
      capabilities() { return { adapter: "mock", supportsTransactions: false, supportsWatch: false }; },
    };

    const run = buildMinimalRun("failed");

    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: false, yes: true, store });

    // Working tree is always preserved (rollback is gone)
    const content = await readFile(join(projectDir, "kept.ts"), "utf-8");
    expect(content).toBe(modifiedContent);

    // PRD status IS reset to "pending" regardless of rollback setting
    expect(currentStatus).toBe("pending");
  });
});
