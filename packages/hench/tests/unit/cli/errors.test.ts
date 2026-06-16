import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  CLI_ERROR_CODES,
  resetColorCache,
  setVerbose,
  E_AUTH_FAILURE,
  E_RATE_LIMIT,
  E_TIMEOUT,
  E_UNKNOWN,
  E_NULL_RESPONSE,
  E_MALFORMED_RESPONSE,
} from "@n-dx/llm-client";
import { CLIError, formatCLIError, handleCLIError, requireHenchDir, requireClaudeCLI } from "../../../src/cli/errors.js";
import { TaskNotActionableError } from "../../../src/agent/planning/brief.js";
import { ClaudeClientError } from "../../../src/prd/llm-gateway.js";

describe("CLIError", () => {
  it("stores message and suggestion", () => {
    const err = new CLIError("something broke", "try this instead");
    expect(err.message).toBe("something broke");
    expect(err.suggestion).toBe("try this instead");
    expect(err.name).toBe("CLIError");
  });

  it("is an instance of Error", () => {
    expect(new CLIError("test")).toBeInstanceOf(Error);
  });
});

describe("formatCLIError", () => {
  it("formats CLIError with suggestion", () => {
    const err = new CLIError("File missing", "Run init first", CLI_ERROR_CODES.CONFIG_NOT_FOUND);
    expect(formatCLIError(err)).toBe(`Error: [${CLI_ERROR_CODES.CONFIG_NOT_FOUND}] File missing\nHint: Run init first`);
  });

  it("never includes stack traces", () => {
    const err = new Error("kaboom");
    const result = formatCLIError(err);
    expect(result).not.toContain("at ");
    expect(result).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] kaboom`);
  });

  it("handles non-Error values", () => {
    expect(formatCLIError("string error")).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] string error`);
  });

  it("matches ENOENT .hench pattern", () => {
    const err = new Error("ENOENT: no such file, open '/tmp/.hench/config.json'");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.NOT_INITIALIZED}]`);
    expect(result).toContain("Hench directory not found");
    expect(result).toContain("Hint:");
  });

  it("matches ENOENT .rex pattern", () => {
    const err = new Error("ENOENT: no such file, open '/tmp/.rex/prd.json'");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.NOT_INITIALIZED}]`);
    expect(result).toContain("Rex directory not found");
    expect(result).toContain("Hint:");
  });

  it("matches claude not found pattern", () => {
    const err = new Error("claude: not found");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.LLM_CLI_NOT_FOUND}]`);
    expect(result).toContain("Claude CLI not found");
    expect(result).toContain("Hint:");
  });

  it("matches ANTHROPIC_API_KEY pattern and emits E_AUTH_FAILURE code", () => {
    // NDX_CLI_API_KEY_MISSING maps to E_AUTH_FAILURE via mapCLICodeToErrorEntry,
    // so the display key is E_AUTH_FAILURE rather than the raw NDX_CLI code.
    const err = new Error("Missing ANTHROPIC_API_KEY environment variable");
    const result = formatCLIError(err);
    expect(result).toContain("[E_AUTH_FAILURE]");
    expect(result).toContain("API key not configured");
    expect(result).toContain("Hint:");
  });

  it("matches Invalid hench config pattern", () => {
    const err = new Error("Invalid hench config: missing required field 'provider'");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.INVALID_CONFIGURATION}]`);
    expect(result).toContain("corrupted or has an invalid format");
    expect(result).toContain("Hint:");
    expect(result).toContain(".hench/config.json");
  });

  it("matches Invalid run record pattern", () => {
    const err = new Error("Invalid run record abc-123: missing required field 'status'");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.INVALID_RUN_RECORD}]`);
    expect(result).toContain("Run record is corrupted");
    expect(result).toContain("Hint:");
    expect(result).toContain(".hench/runs/");
  });

  it("falls back to generic message for unknown errors", () => {
    const err = new Error("some weird internal error");
    expect(formatCLIError(err)).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] some weird internal error`);
  });

  // ── Vendor-neutral ClaudeClientError formatting ──

  it("formats ClaudeClientError with auth reason using E_AUTH_FAILURE code", () => {
    const err = new ClaudeClientError("Error: invalid api key", "auth", false);
    const result = formatCLIError(err);
    expect(result).toContain(`[${E_AUTH_FAILURE.key}]`);
    expect(result).toContain("invalid api key");
    expect(result).toContain("Hint:");
  });

  it("formats ClaudeClientError with rate-limit reason using E_RATE_LIMIT code", () => {
    const err = new ClaudeClientError("429 Too Many Requests", "rate-limit", true);
    const result = formatCLIError(err);
    expect(result).toContain(`[${E_RATE_LIMIT.key}]`);
    expect(result).toContain("Hint:");
  });

  it("formats ClaudeClientError with timeout reason using E_TIMEOUT code", () => {
    const err = new ClaudeClientError("codex exec timed out after 30000ms", "timeout", true);
    const result = formatCLIError(err);
    expect(result).toContain(`[${E_TIMEOUT.key}]`);
    expect(result).toContain("Hint:");
  });

  it("formats ClaudeClientError with unknown reason using E_UNKNOWN code without hint", () => {
    const err = new ClaudeClientError("something unexpected", "unknown", false);
    const result = formatCLIError(err);
    expect(result).toContain(`[${E_UNKNOWN.key}]`);
    expect(result).not.toContain("Hint:");
  });

  it("formats null-response via ERROR_HINTS with E_NULL_RESPONSE code", () => {
    // Simulates what api-provider.ts throws when LLM returns empty text
    const err = new Error("Null or empty response — the LLM returned no text content");
    const result = formatCLIError(err);
    expect(result).toContain(`[${E_NULL_RESPONSE.key}]`);
    expect(result).toContain("Hint:");
  });

  it("formats malformed-response ClaudeClientError with E_MALFORMED_RESPONSE code", () => {
    // ClaudeClientError with reason "unknown" + malformed message falls through
    // to VENDOR_ERROR_PATTERNS which classifies "unexpected token" as malformed_output.
    const err = new ClaudeClientError("unexpected token in JSON response from LLM", "unknown", false);
    const result = formatCLIError(err);
    expect(result).toContain(`[${E_MALFORMED_RESPONSE.key}]`);
  });

  // ── Codex-specific error patterns ──

  it("matches codex not found pattern", () => {
    const err = new Error("codex: not found");
    const result = formatCLIError(err);
    expect(result).toContain("Codex CLI not found");
    expect(result).toContain("Hint:");
  });

  it("matches OPENAI_API_KEY pattern", () => {
    const err = new Error("Missing OPENAI_API_KEY environment variable");
    const result = formatCLIError(err);
    expect(result).toContain("OpenAI API key not configured");
    expect(result).toContain("Hint:");
  });

  it("formats TaskNotActionableError for completed tasks", () => {
    const err = new TaskNotActionableError(
      "task-1", "completed",
      "This task is already complete. Run 'n-dx status' to see remaining work.",
      "Setup CI",
    );
    const result = formatCLIError(err);
    expect(result).toContain("Error:");
    expect(result).toContain("completed");
    expect(result).toContain("Hint:");
    expect(result).toContain("n-dx status");
  });

  it("formats TaskNotActionableError for deferred tasks", () => {
    const err = new TaskNotActionableError(
      "task-2", "deferred",
      "This task has been deferred. To reactivate it, run:\n  rex update task-2 --status=pending",
    );
    const result = formatCLIError(err);
    expect(result).toContain("Error:");
    expect(result).toContain("deferred");
    expect(result).toContain("Hint:");
    expect(result).toContain("rex update");
  });
});

describe("handleCLIError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints formatted error and exits with code 1", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockStderr = vi.spyOn(console, "error").mockImplementation(() => {});

    handleCLIError(new CLIError("test error", "try something"));

    expect(mockStderr).toHaveBeenCalledWith(`Error: [${CLI_ERROR_CODES.GENERIC}] test error\nHint: try something`);
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe("requireClaudeCLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws CLIError when claude is not on PATH", () => {
    // Override PATH to ensure claude won't be found
    const original = process.env.PATH;
    try {
      process.env.PATH = "/nonexistent";
      expect(() => requireClaudeCLI()).toThrow(CLIError);
      expect(() => requireClaudeCLI()).toThrow(/Claude CLI not found/);
    } finally {
      process.env.PATH = original;
    }
  });

  it("includes install instructions in the suggestion", () => {
    const original = process.env.PATH;
    try {
      process.env.PATH = "/nonexistent";
      let caught: CLIError | undefined;
      try {
        requireClaudeCLI();
      } catch (err) {
        caught = err as CLIError;
      }
      expect(caught).toBeInstanceOf(CLIError);
      expect(caught!.suggestion).toContain("npm install -g @anthropic-ai/claude-code");
    } finally {
      process.env.PATH = original;
    }
  });

  it("suggests API provider as fallback", () => {
    const original = process.env.PATH;
    try {
      process.env.PATH = "/nonexistent";
      let caught: CLIError | undefined;
      try {
        requireClaudeCLI();
      } catch (err) {
        caught = err as CLIError;
      }
      expect(caught).toBeInstanceOf(CLIError);
      expect(caught!.suggestion).toContain("hench.provider");
      expect(caught!.suggestion).toContain("api");
    } finally {
      process.env.PATH = original;
    }
  });

  it("does not throw when claude is available", () => {
    // This test only passes if claude is on PATH — skip otherwise
    let hasClaude = false;
    try {
      execFileSync("which", ["claude"], { stdio: "pipe" });
      hasClaude = true;
    } catch {
      // claude not installed, skip
    }

    if (hasClaude) {
      expect(() => requireClaudeCLI()).not.toThrow();
    }
  });
});

describe("requireHenchDir", () => {
  it("throws CLIError when .hench/ does not exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hench-test-"));
    try {
      expect(() => requireHenchDir(tmp)).toThrow(CLIError);
      expect(() => requireHenchDir(tmp)).toThrow(/Hench directory not found/);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("includes n-dx init suggestion in the error", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hench-test-"));
    try {
      let caught: CLIError | undefined;
      try {
        requireHenchDir(tmp);
      } catch (err) {
        caught = err as CLIError;
      }
      expect(caught).toBeInstanceOf(CLIError);
      expect(caught!.suggestion).toContain("n-dx init");
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("does not throw when .hench/ exists", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hench-test-"));
    mkdirSync(join(tmp, ".hench"));
    try {
      expect(() => requireHenchDir(tmp)).not.toThrow();
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });
});

// ── Verbose mode paired assertions ────────────────────────────────────────────
//
// For each LLM error scenario (E_TIMEOUT, E_MALFORMED_RESPONSE, E_NULL_RESPONSE)
// verify that:
//   • Default (non-verbose) run: only the error code + message + optional hint.
//   • --verbose run: additional diagnostic lines are present (raw response + stack trace).
//
// These tests run in CI on both macOS and Linux.

describe("formatCLIError — verbose mode paired assertions", () => {
  afterEach(() => {
    setVerbose(false);
  });

  // ── E_TIMEOUT ──────────────────────────────────────────────────────────────

  it("E_TIMEOUT default: no additional diagnostic lines", () => {
    const err = new ClaudeClientError("codex exec timed out after 30000ms", "timeout", true);
    const result = formatCLIError(err);
    expect(result).toContain(`[${E_TIMEOUT.key}]`);
    expect(result).not.toContain("Raw response:");
    expect(result).not.toContain("Stack trace:");
  });

  it("E_TIMEOUT verbose: additional lines absent in default run are present", () => {
    setVerbose(true);
    const err = new ClaudeClientError("codex exec timed out after 30000ms", "timeout", true);
    const defaultResult = (() => { setVerbose(false); const r = formatCLIError(err); setVerbose(true); return r; })();
    const verboseResult = formatCLIError(err);
    // verbose output must be strictly longer
    expect(verboseResult.length).toBeGreaterThan(defaultResult.length);
    // verbose output contains additional diagnostic lines
    expect(verboseResult).toContain("Raw response:");
    expect(verboseResult).toContain("Stack trace:");
    // error code is still present
    expect(verboseResult).toContain(`[${E_TIMEOUT.key}]`);
  });

  // ── E_MALFORMED_RESPONSE ───────────────────────────────────────────────────

  it("E_MALFORMED_RESPONSE default: no additional diagnostic lines", () => {
    const err = new ClaudeClientError("unexpected token in JSON response from LLM", "unknown", false);
    const result = formatCLIError(err);
    expect(result).toContain(`[${E_MALFORMED_RESPONSE.key}]`);
    expect(result).not.toContain("Raw response:");
    expect(result).not.toContain("Stack trace:");
  });

  it("E_MALFORMED_RESPONSE verbose: additional lines absent in default run are present", () => {
    setVerbose(true);
    const err = new ClaudeClientError("unexpected token in JSON response from LLM", "unknown", false);
    const defaultResult = (() => { setVerbose(false); const r = formatCLIError(err); setVerbose(true); return r; })();
    const verboseResult = formatCLIError(err);
    expect(verboseResult.length).toBeGreaterThan(defaultResult.length);
    expect(verboseResult).toContain("Raw response:");
    expect(verboseResult).toContain("Stack trace:");
    expect(verboseResult).toContain(`[${E_MALFORMED_RESPONSE.key}]`);
  });

  // ── E_NULL_RESPONSE ────────────────────────────────────────────────────────

  it("E_NULL_RESPONSE default: no additional diagnostic lines", () => {
    const err = new Error("Null or empty response — the LLM returned no text content");
    const result = formatCLIError(err);
    expect(result).toContain(`[${E_NULL_RESPONSE.key}]`);
    expect(result).not.toContain("Raw response:");
    expect(result).not.toContain("Stack trace:");
  });

  it("E_NULL_RESPONSE verbose: additional lines absent in default run are present", () => {
    setVerbose(true);
    const err = new Error("Null or empty response — the LLM returned no text content");
    const defaultResult = (() => { setVerbose(false); const r = formatCLIError(err); setVerbose(true); return r; })();
    const verboseResult = formatCLIError(err);
    expect(verboseResult.length).toBeGreaterThan(defaultResult.length);
    expect(verboseResult).toContain("Raw response:");
    expect(verboseResult).toContain("Stack trace:");
    expect(verboseResult).toContain(`[${E_NULL_RESPONSE.key}]`);
  });
});

// ── Yellow color regression tests ─────────────────────────────────────────────
//
// Verify that Hint lines render yellow in TTY mode (FORCE_COLOR=1) and
// produce plain text in NO_COLOR mode.

describe("formatCLIError — Hint line is yellow in TTY mode (FORCE_COLOR)", () => {
  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    resetColorCache();
  });
  afterEach(() => {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    resetColorCache();
  });

  it("Hint line contains ANSI yellow sequence when suggestion is present", () => {
    const err = new CLIError("File missing", "Run ndx init first", CLI_ERROR_CODES.CONFIG_NOT_FOUND);
    const result = formatCLIError(err);
    const hintLine = result.split("\n")[1];
    expect(hintLine).toContain("\x1b[33m");
  });

  it("Hint line resets color after suggestion text", () => {
    const err = new CLIError("File missing", "Run ndx init first", CLI_ERROR_CODES.CONFIG_NOT_FOUND);
    const result = formatCLIError(err);
    const hintLine = result.split("\n")[1];
    expect(hintLine).toContain("\x1b[39m");
  });

  it("ClaudeClientError auth hint renders yellow with E_AUTH_FAILURE code", () => {
    const err = new ClaudeClientError("Error: invalid api key", "auth", false);
    const result = formatCLIError(err);
    expect(result).toContain(`[${E_AUTH_FAILURE.key}]`);
    const hintLine = result.split("\n")[1];
    expect(hintLine).toContain("\x1b[33m");
  });

  it("ENOENT .hench pattern hint renders yellow", () => {
    const err = new Error("ENOENT: no such file, open '/tmp/.hench/config.json'");
    const result = formatCLIError(err);
    const hintLine = result.split("\n")[1];
    expect(hintLine).toContain("\x1b[33m");
    expect(hintLine).toContain("n-dx init");
  });
});

describe("formatCLIError — Hint line is plain text in NO_COLOR mode", () => {
  beforeEach(() => {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    resetColorCache();
  });
  afterEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    resetColorCache();
  });

  it("Hint line contains no ANSI codes under NO_COLOR", () => {
    const err = new CLIError("File missing", "Run ndx init first", CLI_ERROR_CODES.CONFIG_NOT_FOUND);
    const result = formatCLIError(err);
    expect(result).not.toContain("\x1b[");
    expect(result).toContain("Hint: Run ndx init first");
  });
});
