import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for completion validation.
 *
 * Before a task is marked "completed", we validate that meaningful work
 * actually happened — primarily by checking that `git diff` is non-empty.
 * Optionally, a test command can be run for additional verification.
 */

// Mock child_process.execFile before importing the module
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

const mockExecFile = vi.mocked(execFile);

function mockExecFileResult(stdout: string, stderr = "", error: Error | null = null) {
  mockExecFile.mockImplementation(
    ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(error, stdout, stderr);
    }) as typeof execFile,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateCompletion", () => {
  it("passes when git diff shows changes", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult(
      " src/foo.ts | 10 ++++---\n 1 file changed, 7 insertions(+), 3 deletions(-)\n",
    );

    const result = await validateCompletion("/project");

    expect(result.valid).toBe(true);
    expect(result.hasChanges).toBe(true);
  });

  it("fails when git diff is empty", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult("");

    const result = await validateCompletion("/project");

    expect(result.valid).toBe(false);
    expect(result.hasChanges).toBe(false);
    expect(result.reason).toContain("No changes detected");
  });

  it("fails when git diff is whitespace only", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult("  \n  \n");

    const result = await validateCompletion("/project");

    expect(result.valid).toBe(false);
    expect(result.hasChanges).toBe(false);
  });

  it("includes diff summary in result", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    const diffOutput =
      " src/foo.ts | 10 ++++---\n 1 file changed, 7 insertions(+), 3 deletions(-)\n";
    mockExecFileResult(diffOutput);

    const result = await validateCompletion("/project");

    expect(result.diffSummary).toBe(diffOutput.trim());
  });

  it("passes with test command when tests succeed", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    // First call: git diff (has changes)
    // Second call: test command (succeeds)
    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        callCount++;
        if (callCount === 1) {
          cb(null, " src/foo.ts | 5 +++--\n 1 file changed\n", "");
        } else {
          cb(null, "All tests passed", "");
        }
      }) as typeof execFile,
    );

    const result = await validateCompletion("/project", {
      testCommand: "npm test",
    });

    expect(result.valid).toBe(true);
    expect(result.hasChanges).toBe(true);
    expect(result.testsRan).toBe(true);
    expect(result.testsPassed).toBe(true);
  });

  it("fails when test command fails", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        callCount++;
        if (callCount === 1) {
          cb(null, " src/foo.ts | 5 +++--\n 1 file changed\n", "");
        } else {
          const err = new Error("test failed");
          (err as NodeJS.ErrnoException).code = "1";
          cb(err, "", "FAIL: 2 tests failed");
        }
      }) as typeof execFile,
    );

    const result = await validateCompletion("/project", {
      testCommand: "npm test",
    });

    expect(result.valid).toBe(false);
    expect(result.hasChanges).toBe(true);
    expect(result.testsRan).toBe(true);
    expect(result.testsPassed).toBe(false);
    expect(result.reason).toContain("Tests failed");
  });

  it("still validates changes even without test command", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult(" src/foo.ts | 5 +++--\n");

    const result = await validateCompletion("/project");

    expect(result.valid).toBe(true);
    expect(result.testsRan).toBeUndefined();
    expect(result.testsPassed).toBeUndefined();
  });

  it("handles git errors gracefully", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult("", "", new Error("not a git repository"));

    const result = await validateCompletion("/project");

    // Git errors should not crash — treat as "no changes detected"
    expect(result.valid).toBe(false);
    expect(result.hasChanges).toBe(false);
    expect(result.reason).toContain("No changes detected");
  });

  it("checks both staged and unstaged changes", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult(" src/foo.ts | 5 +++--\n");

    await validateCompletion("/project");

    // Should use git diff HEAD to catch both staged and unstaged changes
    const callArgs = mockExecFile.mock.calls[0];
    expect(callArgs[0]).toBe("git");
    expect(callArgs[1]).toContain("--stat");
    expect(callArgs[1]).toContain("HEAD");
  });

  it("diffs against startingHead when provided", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult(" src/foo.ts | 5 +++--\n");

    await validateCompletion("/project", { startingHead: "abc123" });

    const callArgs = mockExecFile.mock.calls[0];
    expect(callArgs[0]).toBe("git");
    expect(callArgs[1]).toContain("--stat");
    expect(callArgs[1]).toContain("abc123");
    expect(callArgs[1]).not.toContain("HEAD");
  });

  it("passes when changes are committed (startingHead differs from current HEAD)", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    // Agent committed its changes, so diff against the starting HEAD still shows changes
    mockExecFileResult(
      " src/foo.ts | 10 ++++---\n 1 file changed, 7 insertions(+), 3 deletions(-)\n",
    );

    const result = await validateCompletion("/project", {
      startingHead: "abc123",
    });

    expect(result.valid).toBe(true);
    expect(result.hasChanges).toBe(true);

    // Verify it diffed against the starting commit, not HEAD
    const callArgs = mockExecFile.mock.calls[0];
    expect(callArgs[1]).toContain("abc123");
  });
});

describe("formatValidationResult", () => {
  it("formats passing result", async () => {
    const { formatValidationResult } = await import("../../../src/agent/completion.js");

    const text = formatValidationResult({
      valid: true,
      hasChanges: true,
      diffSummary: "1 file changed, 5 insertions(+)",
    });

    expect(text).toContain("Changes detected");
    expect(text).toContain("1 file changed");
  });

  it("formats failing result with reason", async () => {
    const { formatValidationResult } = await import("../../../src/agent/completion.js");

    const text = formatValidationResult({
      valid: false,
      hasChanges: false,
      reason: "No changes detected in git diff",
    });

    expect(text).toContain("No changes detected");
  });

  it("formats result with test info", async () => {
    const { formatValidationResult } = await import("../../../src/agent/completion.js");

    const text = formatValidationResult({
      valid: false,
      hasChanges: true,
      testsRan: true,
      testsPassed: false,
      reason: "Tests failed",
    });

    expect(text).toContain("Tests failed");
  });
});
