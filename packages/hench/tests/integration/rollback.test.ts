import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";

const execAsync = promisify(execCb);

/**
 * Working-tree preservation tests.
 *
 * Automatic git rollback on run failure has been removed. Failed, cancelled,
 * and timed-out runs must leave the working tree byte-identical to the state
 * immediately before the error/cancel signal — no git restore, reset, or
 * checkout operations are performed.
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

describe("working-tree preservation on run failure", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-preserve-"));
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

  it("preserves modified file after failed run", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "console.log('original');\n";
    const modifiedContent = "console.log('modified by agent');\n";

    await makeInitialCommit(projectDir, "src.ts", originalContent);
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("failed");

    await finalizeRun({ run, henchDir, projectDir });

    const fileContent = await readFile(join(projectDir, "src.ts"), "utf-8");
    expect(fileContent).toBe(modifiedContent);
  });

  it("preserves new untracked file after failed run", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    await makeInitialCommit(projectDir, "original.ts", "export {};\n");
    await writeFile(join(projectDir, "new-file.ts"), "new file content\n", "utf-8");

    const run = buildMinimalRun("failed");

    await finalizeRun({ run, henchDir, projectDir });

    const content = await readFile(join(projectDir, "new-file.ts"), "utf-8");
    expect(content).toBe("new file content\n");
  });

  it("preserves modified file on cancelled run (SIGINT)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modifiedContent = "export const cancel = 999;\n";
    await makeInitialCommit(projectDir, "lib.ts", "export const cancel = 1;\n");
    await writeFile(join(projectDir, "lib.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("cancelled");

    await finalizeRun({ run, henchDir, projectDir });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(modifiedContent);
  });

  it("preserves modified file on timeout", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modifiedContent = "export const x = 999;\n";
    await makeInitialCommit(projectDir, "lib.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "lib.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("timeout");

    await finalizeRun({ run, henchDir, projectDir });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(modifiedContent);
  });

  it("preserves modified file on budget_exceeded", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modifiedContent = "export const y = 999;\n";
    await makeInitialCommit(projectDir, "lib.ts", "export const y = 1;\n");
    await writeFile(join(projectDir, "lib.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("budget_exceeded");

    await finalizeRun({ run, henchDir, projectDir });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(modifiedContent);
  });

  it("preserves modified file on error_transient", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modifiedContent = "export const z = 999;\n";
    await makeInitialCommit(projectDir, "lib.ts", "export const z = 1;\n");
    await writeFile(join(projectDir, "lib.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("error_transient");

    await finalizeRun({ run, henchDir, projectDir });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(modifiedContent);
  });

  it("preserves modified file when rollbackOnFailure=true (deprecated no-op)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    // rollbackOnFailure is deprecated and has no effect; passing true must
    // still leave the working tree intact.
    const modifiedContent = "export const a = 999;\n";
    await makeInitialCommit(projectDir, "lib.ts", "export const a = 1;\n");
    await writeFile(join(projectDir, "lib.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("failed");

    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: true });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(modifiedContent);
  });

  it("preserves changes on successful completion", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modifiedContent = "console.log('modified by agent');\n";

    await makeInitialCommit(projectDir, "src.ts", "console.log('original');\n");
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("completed");

    await finalizeRun({ run, henchDir, projectDir, skipFullTestGate: true });

    const fileContent = await readFile(join(projectDir, "src.ts"), "utf-8");
    expect(fileContent).toBe(modifiedContent);
  });

  it("preserves changes when --yes is passed on cancellation", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modifiedContent = "export const no_rollback = 999;\n";
    await makeInitialCommit(projectDir, "lib.ts", "export const no_rollback = 1;\n");
    await writeFile(join(projectDir, "lib.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("cancelled");

    await finalizeRun({ run, henchDir, projectDir, yes: true });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(modifiedContent);
  });
});
