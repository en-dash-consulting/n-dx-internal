/**
 * Integration tests — non-retriable error loop termination.
 *
 * Verifies that:
 *  1. `isNonRetriableError` correctly classifies hard-failure statuses.
 *  2. The loop-termination path (stop + exitCode=1) triggers for non-retriable
 *     errors and is bypassed for retriable errors.
 *  3. `formatNonTokenFailureNotification` includes the changed-file count when
 *     provided.
 *
 * These tests exercise the exported helpers from `run.ts` that compose the
 * loop-control decision — avoiding the need to spin up a full agent stack.
 */

import { describe, it, expect } from "vitest";

// ── isNonRetriableError ───────────────────────────────────────────────────────

describe("isNonRetriableError", () => {
  it("returns true for 'failed' — hard agent failure", async () => {
    const { isNonRetriableError } = await import(
      "../../src/cli/commands/run.js"
    );
    expect(isNonRetriableError("failed")).toBe(true);
  });

  it("returns true for 'timeout' — turn-limit exceeded", async () => {
    const { isNonRetriableError } = await import(
      "../../src/cli/commands/run.js"
    );
    expect(isNonRetriableError("timeout")).toBe(true);
  });

  it("returns false for 'budget_exceeded' — retriable token-exhaustion", async () => {
    const { isNonRetriableError } = await import(
      "../../src/cli/commands/run.js"
    );
    expect(isNonRetriableError("budget_exceeded")).toBe(false);
  });

  it("returns false for 'error_transient' — retriable transient error", async () => {
    const { isNonRetriableError } = await import(
      "../../src/cli/commands/run.js"
    );
    expect(isNonRetriableError("error_transient")).toBe(false);
  });

  it("returns false for 'completed'", async () => {
    const { isNonRetriableError } = await import(
      "../../src/cli/commands/run.js"
    );
    expect(isNonRetriableError("completed")).toBe(false);
  });

  it("returns false for 'cancelled'", async () => {
    const { isNonRetriableError } = await import(
      "../../src/cli/commands/run.js"
    );
    expect(isNonRetriableError("cancelled")).toBe(false);
  });
});

// ── formatNonTokenFailureNotification with changedFileCount ───────────────────

describe("formatNonTokenFailureNotification — changedFileCount", () => {
  it("includes file count suffix when changedFileCount > 0", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "agent error", 5);
    expect(msg).toContain("5 files changed");
  });

  it("uses singular 'file' when changedFileCount is 1", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "agent error", 1);
    expect(msg).toContain("1 file changed");
    expect(msg).not.toContain("1 files");
  });

  it("omits file count suffix when changedFileCount is 0", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "agent error", 0);
    expect(msg).not.toContain("changed");
  });

  it("omits file count suffix when changedFileCount is undefined", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "agent error");
    expect(msg).not.toContain("changed");
  });

  it("includes error code alongside file count", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("timeout", undefined, 3);
    expect(msg).toContain("[E_TIMEOUT]");
    expect(msg).toContain("3 files changed");
  });
});

// ── Loop-termination path: stop-on-non-retriable vs continue-on-retriable ────

describe("Loop-termination decision — stop-on-non-retriable path", () => {
  it("non-retriable 'failed': satisfies all conditions for exitCode=1 stop", async () => {
    const { isNonRetriableError, shouldContinueLoop, formatNonTokenFailureNotification } =
      await import("../../src/cli/commands/run.js");

    const status = "failed";
    const error = "Agent spin detected: 45 turns with 0 tool calls.";
    const changedFileCount = 2;

    // Loop must stop (shouldContinueLoop returns false for non-retriable errors)
    expect(shouldContinueLoop(status)).toBe(false);
    // isNonRetriableError gates the exitCode=1 path
    expect(isNonRetriableError(status)).toBe(true);

    // Notification must include error code, cause, and changed-file count
    const notification = formatNonTokenFailureNotification(status, error, changedFileCount);
    expect(notification).toContain("[E_UNKNOWN]"); // spin = unknown code
    expect(notification).toContain("Agent spin detected");
    expect(notification).toContain("2 files changed");

    // Simulate runLoop's exitCode=1 assignment on non-retriable path
    const savedExitCode = process.exitCode;
    try {
      if (!shouldContinueLoop(status) && isNonRetriableError(status)) {
        process.exitCode = 1;
      }
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = savedExitCode as number | undefined;
    }
  });

  it("non-retriable 'timeout': satisfies all conditions for exitCode=1 stop", async () => {
    const { isNonRetriableError, shouldContinueLoop } = await import(
      "../../src/cli/commands/run.js"
    );

    const status = "timeout";

    expect(shouldContinueLoop(status)).toBe(false);
    expect(isNonRetriableError(status)).toBe(true);

    const savedExitCode = process.exitCode;
    try {
      if (!shouldContinueLoop(status) && isNonRetriableError(status)) {
        process.exitCode = 1;
      }
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = savedExitCode as number | undefined;
    }
  });
});

describe("Loop-termination decision — continued-retry path for retriable errors", () => {
  it("retriable 'budget_exceeded': shouldContinueLoop=false but isNonRetriableError=false → no exitCode=1", async () => {
    const { isNonRetriableError, shouldContinueLoop, isTokenExhaustionStatus } =
      await import("../../src/cli/commands/run.js");

    const status = "budget_exceeded";

    // Loop stops (shouldContinueLoop is false) but via token-exhaustion path
    expect(shouldContinueLoop(status)).toBe(false);
    // NOT a non-retriable error — retry path applies
    expect(isNonRetriableError(status)).toBe(false);
    // Classified as token exhaustion
    expect(isTokenExhaustionStatus(status)).toBe(true);

    // exitCode must NOT be set to 1 for retriable errors
    const savedExitCode = process.exitCode;
    try {
      if (!shouldContinueLoop(status) && isNonRetriableError(status)) {
        process.exitCode = 1;
      }
      // exitCode unchanged — budget_exceeded is retriable
      expect(process.exitCode).toBe(savedExitCode);
    } finally {
      process.exitCode = savedExitCode as number | undefined;
    }
  });

  it("retriable 'error_transient': shouldContinueLoop=true → loop continues without exitCode=1", async () => {
    const { isNonRetriableError, shouldContinueLoop, isTokenExhaustionStatus } =
      await import("../../src/cli/commands/run.js");

    const status = "error_transient";

    // error_transient keeps the loop going
    expect(shouldContinueLoop(status)).toBe(true);
    expect(isNonRetriableError(status)).toBe(false);
    expect(isTokenExhaustionStatus(status)).toBe(true);

    // The non-retriable branch is never entered for error_transient
    const savedExitCode = process.exitCode;
    try {
      if (!shouldContinueLoop(status) && isNonRetriableError(status)) {
        process.exitCode = 1;
      }
      expect(process.exitCode).toBe(savedExitCode);
    } finally {
      process.exitCode = savedExitCode as number | undefined;
    }
  });
});
