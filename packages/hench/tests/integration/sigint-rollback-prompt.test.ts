import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { initConfig } from "../../src/store/config.js";

const execAsync = promisify(execCb);

/**
 * Integration tests for the Ctrl+C rollback Y/n prompt.
 *
 * First Ctrl+C → show "Rollback uncommitted changes? [Y/n]"
 * Y/y           → revert git working tree and exit
 * non-Y (n, "")  → exit immediately without rollback
 * second Ctrl+C  → force exit (process.exit(1)) during the prompt
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

interface FakeReadlineHandle {
  /** Simulate the user typing an answer and pressing Enter. */
  answer: (text: string) => void;
  /** Simulate the readline-surface Ctrl+C event. */
  emitRlSigint: () => void;
  closed: boolean;
  question?: string;
}

/**
 * Install a fake `node:readline` module. The returned `fakes` array is
 * populated each time createInterface() is called inside the test.
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
        question: undefined,
      };
      fakes.push(fake);
      return {
        question: (q: string, cb: (answer: string) => void) => {
          fake.question = q;
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

/** Snapshot existing SIGINT listeners and detach them for a test. */
function detachExistingSigintListeners(): Array<(...a: unknown[]) => void> {
  const saved = process.listeners("SIGINT") as Array<(...a: unknown[]) => void>;
  for (const l of saved) process.removeListener("SIGINT", l);
  return saved;
}

/** Restore the snapshot. */
function restoreSigintListeners(saved: Array<(...a: unknown[]) => void>): void {
  for (const l of process.listeners("SIGINT") as Array<(...a: unknown[]) => void>) {
    process.removeListener("SIGINT", l);
  }
  for (const l of saved) process.on("SIGINT", l);
}

describe("promptRollbackOnInterrupt", () => {
  let projectDir: string;
  let henchDir: string;
  let originalIsTTY: boolean | undefined;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-rollback-prompt-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Spy on process.exit to prevent the test process from actually terminating.
    // Cast through unknown to work around the overloaded signature type.
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as unknown as typeof process.exit);

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

  it("Y input triggers rollback (reverts git working tree)", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    const originalContent = "export const x = 1;\n";
    const modifiedContent = "export const x = 999;\n";
    await makeInitialCommit(projectDir, "src.ts", originalContent);
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    const priorListeners = detachExistingSigintListeners();
    try {
      const { promptRollbackOnInterrupt } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const promptPromise = promptRollbackOnInterrupt();
      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);
      expect(fakes[0].question).toContain("[Y/n]");

      // Answer 'Y'
      fakes[0].answer("Y");
      const result = await promptPromise;
      expect(result).toBe(true);

      // The caller is responsible for rollback — simulate it to test the
      // downstream behavior.
      const { revertChanges } = await import(
        "../../src/agent/analysis/review.js"
      );
      await revertChanges(projectDir);

      const content = await readFile(join(projectDir, "src.ts"), "utf-8");
      expect(content).toBe(originalContent);
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("lowercase y input also returns true", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");

    const priorListeners = detachExistingSigintListeners();
    try {
      const { promptRollbackOnInterrupt } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const promptPromise = promptRollbackOnInterrupt();
      await waitForFakePrompt(fakes);
      fakes[0].answer("y");
      const result = await promptPromise;
      expect(result).toBe(true);
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("n input returns false (cancel without rollback)", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    const modifiedContent = "export const x = 999;\n";
    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    const priorListeners = detachExistingSigintListeners();
    try {
      const { promptRollbackOnInterrupt } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const promptPromise = promptRollbackOnInterrupt();
      await waitForFakePrompt(fakes);
      fakes[0].answer("n");
      const result = await promptPromise;
      expect(result).toBe(false);

      // Working tree must be unchanged (no rollback)
      const content = await readFile(join(projectDir, "src.ts"), "utf-8");
      expect(content).toBe(modifiedContent);
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("empty enter returns false (cancel without rollback)", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    const modifiedContent = "export const x = 42;\n";
    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    const priorListeners = detachExistingSigintListeners();
    try {
      const { promptRollbackOnInterrupt } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const promptPromise = promptRollbackOnInterrupt();
      await waitForFakePrompt(fakes);
      // Simulates the user pressing Enter without typing anything
      fakes[0].answer("");
      const result = await promptPromise;
      expect(result).toBe(false);

      const content = await readFile(join(projectDir, "src.ts"), "utf-8");
      expect(content).toBe(modifiedContent);
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("second Ctrl+C during the prompt triggers process.exit(1)", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");

    const priorListeners = detachExistingSigintListeners();
    try {
      const { promptRollbackOnInterrupt } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      // Start the prompt — don't await it. When process.exit(1) fires inside
      // onInterrupt, our mock throws synchronously. That synchronous throw
      // propagates out of emitRlSigint(), not as a promise rejection, so the
      // promise itself never resolves. Attaching .catch() guards against any
      // unhandled-rejection warning in case Node ever changes this.
      void promptRollbackOnInterrupt().catch(() => {});

      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);

      // Outer SIGINT handlers are suspended while the prompt is active —
      // only the force-exit handler inside promptRollbackOnInterrupt is live.
      // Simulate a second Ctrl+C via the readline surface (the same path as
      // pressing Ctrl+C a second time with readline open).
      try {
        fakes[0].emitRlSigint();
      } catch {
        // process.exit mock throws synchronously — this is expected
      }

      // process.exit(1) must have been called
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("suspends outer SIGINT handlers while the prompt is open", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");

    const priorListeners = detachExistingSigintListeners();
    const outerHandler = vi.fn();
    process.on("SIGINT", outerHandler);

    try {
      const { promptRollbackOnInterrupt } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const promptPromise = promptRollbackOnInterrupt();
      await waitForFakePrompt(fakes);

      // While the prompt is open the outer handler must NOT be registered
      expect(process.listeners("SIGINT")).not.toContain(outerHandler);

      // Answer 'n' to resolve the prompt
      fakes[0].answer("n");
      await promptPromise;

      // After resolution the outer handler is restored
      expect(process.listeners("SIGINT")).toContain(outerHandler);
      // And must not have been called (Ctrl+C was not pressed)
      expect(outerHandler).not.toHaveBeenCalled();
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });
});
