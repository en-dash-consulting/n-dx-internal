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
 * Integration tests for the git rollback feature.
 *
 * On run failure, finalizeRun should automatically revert uncommitted
 * file changes made during the run using git reset/checkout/clean.
 * A --no-rollback flag (rollbackOnFailure=false) suppresses this.
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

describe("finalizeRun git rollback", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-rollback-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    // Suppress console output during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await setupGitRepo(projectDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("reverts uncommitted changes when run fails", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "console.log('original');\n";
    const modifiedContent = "console.log('modified by agent');\n";

    await makeInitialCommit(projectDir, "src.ts", originalContent);
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("failed");

    await finalizeRun({
      run,
      henchDir,
      projectDir,
      rollbackOnFailure: true,
    });

    const fileContent = await readFile(join(projectDir, "src.ts"), "utf-8");
    expect(fileContent).toBe(originalContent);
  });

  it("removes untracked files when run fails", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    await makeInitialCommit(projectDir, "original.ts", "export {};\n");
    await writeFile(join(projectDir, "new-file.ts"), "new file content\n", "utf-8");

    const run = buildMinimalRun("failed");

    await finalizeRun({
      run,
      henchDir,
      projectDir,
      rollbackOnFailure: true,
    });

    // Untracked file should be removed by git clean -fd
    let fileExists = true;
    try {
      await readFile(join(projectDir, "new-file.ts"), "utf-8");
    } catch {
      fileExists = false;
    }
    expect(fileExists).toBe(false);
  });

  it("skips rollback silently when working tree is clean", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    await makeInitialCommit(projectDir, "clean.ts", "export {};\n");
    // No changes — working tree is clean

    const run = buildMinimalRun("failed");

    // Should complete without error
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      rollbackOnFailure: true,
    });

    // File should remain unchanged
    const content = await readFile(join(projectDir, "clean.ts"), "utf-8");
    expect(content).toBe("export {};\n");
  });

  it("leaves changes in place when rollbackOnFailure=false (--no-rollback)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "console.log('original');\n";
    const modifiedContent = "console.log('modified by agent');\n";

    await makeInitialCommit(projectDir, "src.ts", originalContent);
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("failed");

    await finalizeRun({
      run,
      henchDir,
      projectDir,
      rollbackOnFailure: false,
    });

    // Changes should NOT be reverted
    const fileContent = await readFile(join(projectDir, "src.ts"), "utf-8");
    expect(fileContent).toBe(modifiedContent);
  });

  it("does not rollback on successful completion", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "console.log('original');\n";
    const modifiedContent = "console.log('modified by agent');\n";

    await makeInitialCommit(projectDir, "src.ts", originalContent);
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("completed");

    await finalizeRun({
      run,
      henchDir,
      projectDir,
      rollbackOnFailure: true,
      skipFullTestGate: true,
    });

    // Changes should NOT be reverted for completed runs
    const fileContent = await readFile(join(projectDir, "src.ts"), "utf-8");
    expect(fileContent).toBe(modifiedContent);
  });

  it("rolls back on timeout status", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "export const x = 1;\n";
    await makeInitialCommit(projectDir, "lib.ts", originalContent);
    await writeFile(join(projectDir, "lib.ts"), "export const x = 999;\n", "utf-8");

    const run = buildMinimalRun("timeout");

    await finalizeRun({
      run,
      henchDir,
      projectDir,
      rollbackOnFailure: true,
    });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(originalContent);
  });

  it("rolls back on budget_exceeded status", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "export const y = 1;\n";
    await makeInitialCommit(projectDir, "lib.ts", originalContent);
    await writeFile(join(projectDir, "lib.ts"), "export const y = 999;\n", "utf-8");

    const run = buildMinimalRun("budget_exceeded");

    await finalizeRun({
      run,
      henchDir,
      projectDir,
      rollbackOnFailure: true,
    });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(originalContent);
  });

  it("rolls back on error_transient status", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "export const z = 1;\n";
    await makeInitialCommit(projectDir, "lib.ts", originalContent);
    await writeFile(join(projectDir, "lib.ts"), "export const z = 999;\n", "utf-8");

    const run = buildMinimalRun("error_transient");

    await finalizeRun({
      run,
      henchDir,
      projectDir,
      rollbackOnFailure: true,
    });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(originalContent);
  });

  it("defaults to rollback when rollbackOnFailure is not specified", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "export const a = 1;\n";
    await makeInitialCommit(projectDir, "lib.ts", originalContent);
    await writeFile(join(projectDir, "lib.ts"), "export const a = 999;\n", "utf-8");

    const run = buildMinimalRun("failed");

    // No rollbackOnFailure specified → defaults to true
    await finalizeRun({
      run,
      henchDir,
      projectDir,
    });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(originalContent);
  });

  it("rolls back on cancelled status (Ctrl+C cancellation)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "export const cancel = 1;\n";
    await makeInitialCommit(projectDir, "lib.ts", originalContent);
    await writeFile(join(projectDir, "lib.ts"), "export const cancel = 999;\n", "utf-8");

    const run = buildMinimalRun("cancelled");

    await finalizeRun({
      run,
      henchDir,
      projectDir,
      rollbackOnFailure: true,
    });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(originalContent);
  });

  it("leaves changes in place when cancellation and --no-rollback", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "export const no_rollback = 1;\n";
    const modifiedContent = "export const no_rollback = 999;\n";
    await makeInitialCommit(projectDir, "lib.ts", originalContent);
    await writeFile(join(projectDir, "lib.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("cancelled");

    await finalizeRun({
      run,
      henchDir,
      projectDir,
      rollbackOnFailure: false,
    });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(modifiedContent);
  });

  // ── Regression: non-token hard failures bypass the rollback prompt ────────
  //
  // Non-token hard failures (failed, timeout) must auto-rollback without
  // showing the interactive rollback confirmation dialog. The prompt only
  // appears for Ctrl+C cancellations (cancelled status).
  //
  // Implementation: finalizeRun passes `yes=true` to performRollbackIfNeeded
  // when `isNonTokenHardFailure` is true (status === "failed" || "timeout").
  // This suppresses readline regardless of process.stdin.isTTY.
  //
  // The behavioral test: with process.stdin.isTTY=true, finalizeRun must
  // resolve promptly (no readline call would hang). The rollback must happen.

  it("auto-rollbacks without prompt for non-token hard failure (E_MALFORMED_RESPONSE / failed)", async () => {
    // A failed run with malformed-response error (E_MALFORMED_RESPONSE category)
    // must roll back automatically and resolve immediately — no interactive prompt.
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "export const malformed = 1;\n";
    const modifiedContent = "export const malformed = 999;\n";

    await makeInitialCommit(projectDir, "src.ts", originalContent);
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("failed");
    run.error = "malformed response from LLM";

    // Simulate an interactive terminal. For cancelled status this would block
    // on a readline prompt; for failed (non-token) it must not block at all.
    const isTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });

    try {
      // Must resolve promptly — no readline wait.
      await finalizeRun({
        run,
        henchDir,
        projectDir,
        rollbackOnFailure: true,
      });

      // Rollback must have happened (file reverted to committed state).
      const content = await readFile(join(projectDir, "src.ts"), "utf-8");
      expect(content).toBe(originalContent);
    } finally {
      if (isTTYDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", isTTYDescriptor);
      } else {
        Object.defineProperty(process.stdin, "isTTY", {
          value: undefined,
          configurable: true,
          writable: true,
        });
      }
    }
  });

  it("auto-rollbacks without prompt for non-token hard failure (timeout)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "export const to = 1;\n";
    const modifiedContent = "export const to = 999;\n";

    await makeInitialCommit(projectDir, "src.ts", originalContent);
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("timeout");
    run.error = "Exceeded max turns (20)";

    const isTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });

    try {
      await finalizeRun({
        run,
        henchDir,
        projectDir,
        rollbackOnFailure: true,
      });

      const content = await readFile(join(projectDir, "src.ts"), "utf-8");
      expect(content).toBe(originalContent);
    } finally {
      if (isTTYDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", isTTYDescriptor);
      } else {
        Object.defineProperty(process.stdin, "isTTY", {
          value: undefined,
          configurable: true,
          writable: true,
        });
      }
    }
  });
});
