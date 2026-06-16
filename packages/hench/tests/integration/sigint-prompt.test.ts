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
 * Integration tests for SIGINT handling during interactive prompts.
 *
 * Automatic git rollback on run failure has been removed. Failed/cancelled runs
 * no longer open a readline prompt asking whether to roll back. This file now
 * verifies:
 *
 *  1. No readline prompt is opened on failed or cancelled runs — SIGINT handlers
 *     are never suspended by finalization on failure paths.
 *  2. The commit-approval prompt still correctly suspends SIGINT so the user can
 *     answer without the second Ctrl-C killing the process.
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

function buildCompletedRun(): RunRecord {
  return buildMinimalRun("completed");
}

interface FakeReadlineHandle {
  answer: (text: string) => void;
  /** Trigger the readline-surface SIGINT event (raw-mode Ctrl-C path). */
  emitRlSigint: () => void;
  closed: boolean;
}

/**
 * Install a fake `node:readline` module that stores the answer callback
 * and tracks listeners registered via `rl.on(...)`. The returned `fakes`
 * array captures each interface the code under test opens so tests can
 * drive the prompt deterministically.
 */
function installFakeReadline(): { fakes: FakeReadlineHandle[] } {
  const fakes: FakeReadlineHandle[] = [];
  vi.doMock("node:readline", () => ({
    createInterface: () => {
      let answerCb: ((answer: string) => void) | undefined;
      const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
      const fake: FakeReadlineHandle = {
        answer: (text: string) => answerCb?.(text),
        emitRlSigint: () => {
          for (const l of listeners.SIGINT ?? []) l();
        },
        closed: false,
      };
      fakes.push(fake);
      return {
        question: (_q: string, cb: (answer: string) => void) => {
          answerCb = cb;
        },
        close: () => {
          fake.closed = true;
        },
        on: (event: string, listener: (...a: unknown[]) => void) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(listener);
        },
        removeListener: (event: string, listener: (...a: unknown[]) => void) => {
          const arr = listeners[event];
          if (!arr) return;
          const idx = arr.indexOf(listener);
          if (idx >= 0) arr.splice(idx, 1);
        },
      };
    },
  }));
  return { fakes };
}

async function waitForFakePrompt(fakes: FakeReadlineHandle[]): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (fakes.length === 0 && Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 10));
  }
}

/** Snapshot existing SIGINT listeners and clear the slot for a test. */
function detachExistingSigintListeners(): Array<(...a: unknown[]) => void> {
  const saved = process.listeners("SIGINT") as Array<(...a: unknown[]) => void>;
  for (const l of saved) process.removeListener("SIGINT", l);
  return saved;
}

/** Restore the snapshot — drops whatever the test installed and
 *  re-installs the original set exactly once. */
function restoreSigintListeners(saved: Array<(...a: unknown[]) => void>): void {
  for (const l of process.listeners("SIGINT") as Array<(...a: unknown[]) => void>) {
    process.removeListener("SIGINT", l);
  }
  for (const l of saved) process.on("SIGINT", l);
}

describe("prompt SIGINT suspension", () => {
  let projectDir: string;
  let henchDir: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-sigint-prompt-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await setupGitRepo(projectDir);

    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
  });

  afterEach(async () => {
    vi.doUnmock("node:readline");
    vi.resetModules();
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    await rm(projectDir, { recursive: true, force: true });
  });

  it("does not open a readline prompt on failed run (no rollback prompt)", async () => {
    // Automatic rollback has been removed. finalizeRun must complete without
    // ever creating a readline interface on a failed run.
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "src.ts"), "export const x = 999;\n", "utf-8");

    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const run = buildMinimalRun("failed");
    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: true });

    // No readline interface must have been created.
    expect(fakes).toHaveLength(0);
  });

  it("does not open a readline prompt on cancelled run (no rollback prompt)", async () => {
    // Cancelled runs previously opened a y/n rollback prompt. That prompt
    // is gone — finalizeRun must complete immediately with no readline open.
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "src.ts"), "export const x = 999;\n", "utf-8");

    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const run = buildMinimalRun("cancelled");
    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: true });

    // No readline interface must have been created.
    expect(fakes).toHaveLength(0);
  });

  it("does not suspend SIGINT handlers on cancelled run", async () => {
    // Previously finalizeRun on a cancelled run suspended SIGINT while the
    // rollback prompt was open. Now finalization must complete without ever
    // removing SIGINT listeners.
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "src.ts"), "export const x = 999;\n", "utf-8");

    const priorListeners = detachExistingSigintListeners();
    const outerHandler = vi.fn();
    process.on("SIGINT", outerHandler);

    try {
      const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

      const run = buildMinimalRun("cancelled");
      await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: true });

      // Outer handler must still be registered (never suspended).
      expect(process.listeners("SIGINT")).toContain(outerHandler);
      // No readline prompt opened.
      expect(fakes).toHaveLength(0);
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("preserves working tree on cancelled run (no rollback prompt)", async () => {
    // Verify that cancellation leaves the file as the agent left it —
    // no readline prompt AND no git revert.
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    const modifiedContent = "export const x = 999;\n";
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const run = buildMinimalRun("cancelled");
    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: true });

    expect(fakes).toHaveLength(0);

    const content = await readFile(join(projectDir, "src.ts"), "utf-8");
    expect(content).toBe(modifiedContent);
  });

  it("applies the same SIGINT suspension to the commit-approval prompt", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    // Stage a change and write a pending commit message so the commit
    // prompt path activates.
    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: bump x", "utf-8");

    const priorListeners = detachExistingSigintListeners();
    const outerHandler = vi.fn();
    process.on("SIGINT", outerHandler);

    try {
      const { performCommitPromptIfNeeded } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const run = buildCompletedRun();
      const promptPromise = performCommitPromptIfNeeded(
        run,
        projectDir,
        /* autoCommit */ false,
        /* yes */ false,
        /* autonomous */ false,
      );

      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);

      // Outer handler is suspended — a SIGINT during the commit prompt
      // must not reach it and must not call process.exit(1).
      expect(process.listeners("SIGINT")).not.toContain(outerHandler);
      process.emit("SIGINT");

      await promptPromise;

      expect(outerHandler).not.toHaveBeenCalled();
      expect(process.listeners("SIGINT")).toContain(outerHandler);
      expect(fakes[0].closed).toBe(true);
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });
});
