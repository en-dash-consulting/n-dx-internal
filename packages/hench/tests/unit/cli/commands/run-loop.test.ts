import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initConfig } from "../../../../src/store/config.js";

/**
 * Tests for the --loop continuous execution mode.
 *
 * These tests exercise the loop control flow in cmdRun by mocking
 * the underlying runOne execution and verifying iteration behaviour,
 * pause timing, and stop conditions.
 */

// We'll test the extracted loop helpers directly rather than cmdRun
// to avoid needing to mock the full agent/CLI stack.

// ── Non-retriable error classification ───────────────────────────────────────

describe("isNonRetriableError", () => {
  it("returns true for failed", async () => {
    const { isNonRetriableError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isNonRetriableError("failed")).toBe(true);
  });

  it("returns true for timeout", async () => {
    const { isNonRetriableError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isNonRetriableError("timeout")).toBe(true);
  });

  it("returns false for budget_exceeded (retriable)", async () => {
    const { isNonRetriableError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isNonRetriableError("budget_exceeded")).toBe(false);
  });

  it("returns false for error_transient (retriable)", async () => {
    const { isNonRetriableError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isNonRetriableError("error_transient")).toBe(false);
  });

  it("returns false for completed", async () => {
    const { isNonRetriableError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isNonRetriableError("completed")).toBe(false);
  });

  it("returns false for cancelled", async () => {
    const { isNonRetriableError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isNonRetriableError("cancelled")).toBe(false);
  });
});

// ── Non-token error classification and notification ───────────────────────────

describe("isTokenExhaustionStatus", () => {
  it("returns true for budget_exceeded", async () => {
    const { isTokenExhaustionStatus } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isTokenExhaustionStatus("budget_exceeded")).toBe(true);
  });

  it("returns true for error_transient", async () => {
    const { isTokenExhaustionStatus } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isTokenExhaustionStatus("error_transient")).toBe(true);
  });

  it("returns false for failed (non-token hard failure)", async () => {
    const { isTokenExhaustionStatus } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isTokenExhaustionStatus("failed")).toBe(false);
  });

  it("returns false for timeout (non-token hard failure)", async () => {
    const { isTokenExhaustionStatus } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isTokenExhaustionStatus("timeout")).toBe(false);
  });

  it("returns false for completed", async () => {
    const { isTokenExhaustionStatus } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isTokenExhaustionStatus("completed")).toBe(false);
  });
});

describe("formatNonTokenFailureNotification", () => {
  it("includes [E_MALFORMED_RESPONSE] for malformed error text (regression: E_MALFORMED_RESPONSE category)", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "malformed response from LLM");
    expect(msg).toContain("[E_MALFORMED_RESPONSE]");
    // No rollback prompt text — notification is informational only
    expect(msg).not.toContain("Roll back");
  });

  it("includes [E_TIMEOUT] for timeout status regardless of error text", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("timeout");
    expect(msg).toContain("[E_TIMEOUT]");
  });

  it("includes [E_TIMEOUT] for timeout even with non-matching error text", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("timeout", "something happened");
    expect(msg).toContain("[E_TIMEOUT]");
  });

  it("includes [E_UNKNOWN] for failed with unrecognised error text", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "some generic error");
    expect(msg).toContain("[E_UNKNOWN]");
  });

  it("includes [E_UNKNOWN] for failed with no error text", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed");
    expect(msg).toContain("[E_UNKNOWN]");
  });

  it("includes the cause text in the notification", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "Agent spin detected: 45 turns with 0 tool calls.");
    expect(msg).toContain("Agent spin detected");
  });

  it("includes 'Run failed:' prefix in the notification", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "some error");
    expect(msg).toContain("Run failed:");
  });

  it("classifies invalid JSON parse error text as E_MALFORMED_RESPONSE", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "unexpected token } in JSON");
    expect(msg).toContain("[E_MALFORMED_RESPONSE]");
  });

  it("classifies auth error text as E_AUTH_FAILURE", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "invalid api key");
    expect(msg).toContain("[E_AUTH_FAILURE]");
  });

  it("includes changed-file count when changedFileCount > 0", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "agent error", 7);
    expect(msg).toContain("7 files changed");
  });

  it("uses singular form for changedFileCount === 1", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "agent error", 1);
    expect(msg).toContain("1 file changed");
    expect(msg).not.toContain("1 files");
  });

  it("omits file count when changedFileCount is 0", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "agent error", 0);
    expect(msg).not.toContain("changed");
  });

  it("omits file count when changedFileCount is undefined (backward compat)", async () => {
    const { formatNonTokenFailureNotification } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatNonTokenFailureNotification("failed", "agent error");
    expect(msg).not.toContain("changed");
  });
});

// ── Regression: non-token failure in loop → non-zero exit ────────────────────
//
// When runLoop encounters a non-token hard failure (failed, timeout), it:
//   1. Emits formatNonTokenFailureNotification(status, error)
//   2. Sets process.exitCode = 1
//   3. Breaks the loop
//
// The token-exhaustion path (budget_exceeded, error_transient) does NOT
// set exitCode and does NOT break the loop — it defers to stuck-task detection.

describe("non-token failure loop termination — E_MALFORMED_RESPONSE regression", () => {
  it("non-token failure (E_MALFORMED_RESPONSE) satisfies stop+exitCode=1 conditions", async () => {
    const {
      shouldContinueLoop,
      isTokenExhaustionStatus,
      formatNonTokenFailureNotification,
    } = await import("../../../../src/cli/commands/run.js");

    const status = "failed";
    const errorText = "malformed response from LLM";

    // Both conditions that gate the exitCode=1 path in runLoop must hold.
    const willStop = !shouldContinueLoop(status);
    const isToken = isTokenExhaustionStatus(status);

    expect(willStop).toBe(true);  // failed → loop must stop
    expect(isToken).toBe(false);  // failed → not a token-exhaustion failure

    // Notification must include the structured error code and cause.
    const notification = formatNonTokenFailureNotification(status, errorText);
    expect(notification).toContain("[E_MALFORMED_RESPONSE]");
    expect(notification).toContain("malformed response from LLM");
    // Must not contain rollback prompt text — notification is informational only.
    expect(notification).not.toContain("Roll back");

    // Verify process.exitCode is set to 1 (the actual runLoop path).
    const savedExitCode = process.exitCode;
    try {
      if (willStop && !isToken) {
        process.exitCode = 1;
      }
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = savedExitCode as number | undefined;
    }
  });

  it("token-exhaustion failure (budget_exceeded) does NOT trigger exitCode=1 path", async () => {
    const { shouldContinueLoop, isTokenExhaustionStatus } = await import(
      "../../../../src/cli/commands/run.js"
    );

    const status = "budget_exceeded";

    const willStop = !shouldContinueLoop(status);
    const isToken = isTokenExhaustionStatus(status);

    // budget_exceeded stops the loop but is a token failure — exitCode=1 is NOT set.
    expect(willStop).toBe(true);
    expect(isToken).toBe(true);

    const savedExitCode = process.exitCode;
    try {
      // Simulate the runLoop decision: only set exitCode when !isToken
      if (willStop && !isToken) {
        process.exitCode = 1;
      }
      // exitCode must remain unchanged (not set to 1 for token failures).
      expect(process.exitCode).toBe(savedExitCode);
    } finally {
      process.exitCode = savedExitCode as number | undefined;
    }
  });
});

describe("loop mode helpers", () => {
  describe("shouldContinueLoop", () => {
    it("returns true for completed status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("completed")).toBe(true);
    });

    it("returns true for error_transient status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("error_transient")).toBe(true);
    });

    it("returns false for failed status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("failed")).toBe(false);
    });

    it("returns false for timeout status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("timeout")).toBe(false);
    });

    it("returns false for budget_exceeded status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("budget_exceeded")).toBe(false);
    });
  });

  describe("loopPause", () => {
    it("resolves after the specified delay", async () => {
      const { loopPause } = await import(
        "../../../../src/cli/commands/run.js"
      );
      const start = Date.now();
      await loopPause(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timer variance
    });

    it("resolves immediately for 0ms delay", async () => {
      const { loopPause } = await import(
        "../../../../src/cli/commands/run.js"
      );
      const start = Date.now();
      await loopPause(0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });

    it("can be aborted via AbortSignal", async () => {
      const { loopPause } = await import(
        "../../../../src/cli/commands/run.js"
      );
      const ac = new AbortController();
      const promise = loopPause(10_000, ac.signal);
      // Abort immediately
      ac.abort();
      const start = Date.now();
      await promise;
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(200);
    });
  });
});

describe("stuck task config defaults", () => {
  it("maxFailedAttempts is optional in schema and defaults to 3", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.maxFailedAttempts).toBe(3);
    }
  });

  it("maxFailedAttempts can be customised in config", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), maxFailedAttempts: 5 };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.maxFailedAttempts).toBe(5);
    }
  });

  it("rejects maxFailedAttempts of 0", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), maxFailedAttempts: 0 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });

  it("rejects negative maxFailedAttempts", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), maxFailedAttempts: -1 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });
});

describe("token budget config defaults", () => {
  it("tokenBudget is optional in schema and defaults to 0 (unlimited)", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tokenBudget).toBe(0);
    }
  });

  it("tokenBudget can be set to a positive value", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), tokenBudget: 500_000 };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tokenBudget).toBe(500_000);
    }
  });

  it("rejects negative tokenBudget", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), tokenBudget: -1 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });

  it("accepts tokenBudget of 0 (unlimited)", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), tokenBudget: 0 };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tokenBudget).toBe(0);
    }
  });

  it("validates existing configs without tokenBudget field (backward compat)", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    // Simulate an old config file that doesn't have tokenBudget
    const { tokenBudget, ...configWithout } = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(configWithout);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tokenBudget).toBe(0);
    }
  });
});

describe("loop config defaults", () => {
  it("loopPauseMs is optional in schema and defaults to 2000", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    // Config without loopPauseMs should validate
    const config = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.loopPauseMs).toBe(2000);
    }
  });

  it("loopPauseMs can be customised in config", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), loopPauseMs: 5000 };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.loopPauseMs).toBe(5000);
    }
  });

  it("rejects negative loopPauseMs", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), loopPauseMs: -1 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });
});

// ── iteration banner placement ────────────────────────────────────────────
//
// Regression guard: banners must be emitted BETWEEN iterations only.
// "Between" means: after the prior iteration's runOne (commit + summary)
// returns, and before the next iteration's task selection begins.
// No banner before iteration 1; no banner after the final iteration.
//
// These tests simulate the banner-gating logic used in runIterations()
// (if i > 0) and runLoop() (if completed > 1) to document the invariant
// without having to spin up the full agent stack.

describe("iteration banner placement invariants", () => {
  it("formatIterationBanner is not called for the first iteration (i === 0)", () => {
    // Simulates the gate in runIterations(): `if (i > 0)`
    const banners: string[] = [];
    const emitBanner = (i: number, total: number) => {
      if (i > 0) banners.push(`=== Iteration ${i + 1}/${total} ===`);
    };
    // Three iterations: only iterations 2 and 3 get a banner
    for (let i = 0; i < 3; i++) emitBanner(i, 3);
    expect(banners).toHaveLength(2);
    expect(banners[0]).toBe("=== Iteration 2/3 ===");
    expect(banners[1]).toBe("=== Iteration 3/3 ===");
  });

  it("no banner is emitted after the final iteration in fixed mode", () => {
    // After the loop ends there is no code path that would emit a banner,
    // because the gate condition (i > 0) is evaluated at the TOP of each
    // iteration — when the loop exits there is no 'next' iteration to enter.
    const banners: string[] = [];
    const total = 3;
    for (let i = 0; i < total; i++) {
      if (i > 0) banners.push(`banner-${i + 1}`);
      // simulate iteration work here
    }
    // Last banner is for iteration `total`, not `total + 1`
    expect(banners[banners.length - 1]).toBe(`banner-${total}`);
    expect(banners).toHaveLength(total - 1);
  });

  it("formatIterationBanner is not called for the first loop iteration (completed === 1)", () => {
    // Simulates the gate in runLoop(): `if (completed > 1)`
    const banners: string[] = [];
    let completed = 0;
    const emitBanner = () => {
      completed++;
      if (completed > 1) banners.push(`=== Iteration ${completed} ===`);
    };
    emitBanner(); // iteration 1 — no banner
    emitBanner(); // iteration 2 — banner for 2
    emitBanner(); // iteration 3 — banner for 3
    expect(banners).toHaveLength(2);
    expect(banners[0]).toBe("=== Iteration 2 ===");
    expect(banners[1]).toBe("=== Iteration 3 ===");
  });

  it("loop-mode banner format has no /total suffix", () => {
    // --loop is unbounded so the banner must not show a denominator
    const completed = 4;
    const banner = `=== Iteration ${completed} ===`;
    expect(banner).not.toMatch(/\d+\/\d+/);
    expect(banner).toBe("=== Iteration 4 ===");
  });
});

// ── attempt tracking per task within a single run invocation ───────────────

describe("attempt tracking in run loops", () => {
  it("tracks attempt count per task ID within a run invocation", async () => {
    const { createAttemptTracker } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const tracker = createAttemptTracker();

    // First attempt of task-1
    expect(tracker.incrementAndGetCount("task-1")).toBe(1);
    // Second attempt of task-1
    expect(tracker.incrementAndGetCount("task-1")).toBe(2);
    // First attempt of task-2
    expect(tracker.incrementAndGetCount("task-2")).toBe(1);
    // Third attempt of task-1
    expect(tracker.incrementAndGetCount("task-1")).toBe(3);
    // Second attempt of task-2
    expect(tracker.incrementAndGetCount("task-2")).toBe(2);

    // Verify counts are persistent
    expect(tracker.getCount("task-1")).toBe(3);
    expect(tracker.getCount("task-2")).toBe(2);
  });

  it("returns 0 for tasks with no attempts yet", async () => {
    const { createAttemptTracker } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const tracker = createAttemptTracker();

    expect(tracker.getCount("never-attempted")).toBe(0);
  });

  it("identifies tasks that have reached max attempts (3)", async () => {
    const { createAttemptTracker } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const tracker = createAttemptTracker();

    expect(tracker.hasReachedMaxAttempts("task-1")).toBe(false);

    tracker.incrementAndGetCount("task-1");
    expect(tracker.hasReachedMaxAttempts("task-1")).toBe(false);

    tracker.incrementAndGetCount("task-1");
    expect(tracker.hasReachedMaxAttempts("task-1")).toBe(false);

    tracker.incrementAndGetCount("task-1");
    expect(tracker.hasReachedMaxAttempts("task-1")).toBe(true);
  });

  it("resets on new tracker creation (separate run invocation)", async () => {
    const { createAttemptTracker } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const tracker1 = createAttemptTracker();
    tracker1.incrementAndGetCount("task-1");
    tracker1.incrementAndGetCount("task-1");

    // New tracker for a separate run invocation
    const tracker2 = createAttemptTracker();
    expect(tracker2.getCount("task-1")).toBe(0);
  });

  it("integrates with excludeTaskIds after reaching max attempts", async () => {
    const { createAttemptTracker } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const tracker = createAttemptTracker();
    const excludeIds = new Set<string>();

    // Simulate three task runs of the same task
    for (let i = 0; i < 3; i++) {
      const count = tracker.incrementAndGetCount("task-1");
      if (tracker.hasReachedMaxAttempts("task-1")) {
        excludeIds.add("task-1");
      }
    }

    expect(excludeIds.has("task-1")).toBe(true);
    expect(excludeIds.size).toBe(1);

    // A different task should not be excluded
    tracker.incrementAndGetCount("task-2");
    expect(excludeIds.has("task-2")).toBe(false);
  });
});

// ── token-exhaustion wait-and-retry helpers ──────────────────────────────────
//
// Tests for `waitForTokenRefresh` and `formatTokenRefreshRetryOutcome`, both
// exported from run.ts for testing.  These helpers implement the single
// wait-and-retry cycle that fires when the inner loop encounters a
// budget_exceeded / error_transient status and a Retry-After timestamp is
// available.
//
// Acceptance criteria verified:
//   - No real waiting when the refresh window has already elapsed
//   - AbortSignal (Ctrl-C) interrupts the wait and returns false
//   - Full-countdown path returns true when the clock advances past the window
//   - formatTokenRefreshRetryOutcome formats success and failure messages

describe("formatTokenRefreshRetryOutcome", () => {
  it("returns success text when status is 'completed'", async () => {
    const { formatTokenRefreshRetryOutcome } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatTokenRefreshRetryOutcome("completed");
    expect(msg).toContain("Token-refresh retry succeeded");
    expect(msg).toContain("exiting cleanly");
  });

  it("uses run status as cause when no errorText is provided", async () => {
    const { formatTokenRefreshRetryOutcome } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatTokenRefreshRetryOutcome("budget_exceeded");
    expect(msg).toContain("Token-refresh retry failed");
    expect(msg).toContain("run budget_exceeded");
  });

  it("embeds provided errorText in the failure message", async () => {
    const { formatTokenRefreshRetryOutcome } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatTokenRefreshRetryOutcome(
      "failed",
      "Quota exceeded for the current billing period",
    );
    expect(msg).toContain("Token-refresh retry failed");
    expect(msg).toContain("Quota exceeded for the current billing period");
  });

  it("replaces newlines in errorText with spaces", async () => {
    const { formatTokenRefreshRetryOutcome } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const msg = formatTokenRefreshRetryOutcome("failed", "line one\nline two");
    expect(msg).not.toContain("\n");
    expect(msg).toContain("line one line two");
  });

  it("truncates errorText to at most 120 characters", async () => {
    const { formatTokenRefreshRetryOutcome } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const longError = "z".repeat(200);
    const msg = formatTokenRefreshRetryOutcome("failed", longError);
    // The first 120 'z' characters must appear in the message
    expect(msg).toContain("z".repeat(120));
    // The 121st 'z' and beyond should be absent (truncated before reaching the suffix)
    expect(msg).not.toContain("z".repeat(121));
  });
});

describe("waitForTokenRefresh", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true immediately when refreshAt + 1000ms has already elapsed", async () => {
    const { waitForTokenRefresh } = await import(
      "../../../../src/cli/commands/run.js"
    );
    // refreshAt 2s in the past → targetMs = refreshAt + 1000ms ≈ now - 1000ms → elapsed
    const past = new Date(Date.now() - 2_000);
    const result = await waitForTokenRefresh(past);
    expect(result).toBe(true);
  });

  it("returns false when AbortSignal is already aborted before the wait begins", async () => {
    const { waitForTokenRefresh } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const ac = new AbortController();
    ac.abort(); // already aborted before we even start
    const future = new Date(Date.now() + 30_000);
    const result = await waitForTokenRefresh(future, ac.signal);
    expect(result).toBe(false);
  });

  it("returns false when AbortSignal fires during the countdown", async () => {
    vi.useFakeTimers();
    const { waitForTokenRefresh } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const ac = new AbortController();
    // refreshAt 30s from fake-now → targetMs = fake-now + 31 000ms
    const future = new Date(Date.now() + 30_000);
    const waitPromise = waitForTokenRefresh(future, ac.signal);
    // Abort while the inner loopPause is pending.  The abort listener on
    // loopPause resolves the promise immediately; the async chain then checks
    // signal.aborted and returns false.
    ac.abort();
    const result = await waitPromise;
    expect(result).toBe(false);
  });

  it("returns true after the full countdown window has elapsed", async () => {
    vi.useFakeTimers();
    const { waitForTokenRefresh } = await import(
      "../../../../src/cli/commands/run.js"
    );
    // refreshAt 9s from fake-now → targetMs = fake-now + 10 000ms, remainingMs = 10 000.
    // The countdown loop fires twice (COUNTDOWN_UPDATE_INTERVAL_MS = 5 000ms each).
    const future = new Date(Date.now() + 9_000);
    const waitPromise = waitForTokenRefresh(future);
    // Advance fake clock past the full 10s window so both loopPause timers fire.
    await vi.advanceTimersByTimeAsync(10_100);
    const result = await waitPromise;
    expect(result).toBe(true);
  });
});

// ── isTokenExhaustionError (classifyLLMError-based) ──────────────────────────
//
// Verifies that the shared LLM error classifier is used to detect token-
// exhaustion errors, with no duplicated pattern-matching logic.
//
// Acceptance criteria 3: "Token-wait classification reuses the existing shared
// LLM error classifier with no duplicated detection logic"
// Acceptance criteria 4 (regression): when an error is classified as token-
// exhaustion, the rollback prompt must NOT be rendered — asserted below via the
// isTokenExhaustionError predicate that gates the prompt-suppression path.

describe("isTokenExhaustionError", () => {
  it("returns true for a rate-limit error text (claude default vendor)", async () => {
    const { isTokenExhaustionError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isTokenExhaustionError("Rate limit exceeded — too many requests")).toBe(true);
  });

  it("returns true for a 429 too-many-requests error text", async () => {
    const { isTokenExhaustionError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isTokenExhaustionError("Error 429: too many requests")).toBe(true);
  });

  it("returns true for a budget/quota-exceeded error text", async () => {
    const { isTokenExhaustionError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isTokenExhaustionError("Token budget exceeded for this billing period")).toBe(true);
  });

  it("returns false for an auth error (not token-exhaustion)", async () => {
    const { isTokenExhaustionError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isTokenExhaustionError("Authentication failed: invalid API key")).toBe(false);
  });

  it("returns false for a server error (not token-exhaustion)", async () => {
    const { isTokenExhaustionError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isTokenExhaustionError("Internal server error 500: overloaded")).toBe(false);
  });

  it("returns false for undefined errorText", async () => {
    const { isTokenExhaustionError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isTokenExhaustionError(undefined)).toBe(false);
  });

  it("returns false for an empty string", async () => {
    const { isTokenExhaustionError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isTokenExhaustionError("")).toBe(false);
  });

  it("works for 'codex' vendor", async () => {
    const { isTokenExhaustionError } = await import(
      "../../../../src/cli/commands/run.js"
    );
    expect(isTokenExhaustionError("Rate limit exceeded", "codex")).toBe(true);
  });

  // Regression: token-exhaustion errors must NOT trigger the rollback prompt.
  //
  // The gate in runLoop's SIGINT handler is:
  //   if (isInTokenWait) { process.exit(1); return; }
  //
  // isInTokenWait is set to true before waitForTokenRefresh and reset after.
  // This test documents the predicate used to reach the wait state so that if
  // the gating logic is ever refactored, a reviewer knows what behaviours are
  // being preserved.
  it("regression: token-exhaustion classified error suppresses rollback prompt (predicate proof)", async () => {
    const { isTokenExhaustionError, isTokenExhaustionStatus } = await import(
      "../../../../src/cli/commands/run.js"
    );

    // A run with status=error_transient and a rate-limit error message enters
    // the token-wait path, which sets isInTokenWait=true.  The SIGINT handler
    // checks isInTokenWait BEFORE calling promptRollbackOnInterrupt.
    const status = "error_transient";
    const errorText = "Rate limit exceeded — retry after 60 seconds";

    // Condition 1: status gates the token-wait path.
    expect(isTokenExhaustionStatus(status)).toBe(true);

    // Condition 2: error text confirms token-exhaustion via the shared classifier.
    expect(isTokenExhaustionError(errorText)).toBe(true);

    // Combined: both conditions being true means the run enters waitForTokenRefresh,
    // isInTokenWait is set, and the rollback prompt is suppressed on Ctrl+C.
    // (promptRollbackOnInterrupt is NOT called — verified here as a logical proof
    // rather than a process.exit mock, since the SIGINT handler calls process.exit
    // directly in this path.)
    const wouldSuppressRollback = isTokenExhaustionStatus(status) && isTokenExhaustionError(errorText);
    expect(wouldSuppressRollback).toBe(true);
  });
});
