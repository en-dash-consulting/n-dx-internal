import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLI_ERROR_CODES, resetColorCache, setVerbose } from "@n-dx/llm-client";
import { CLIError, BudgetExceededError, formatCLIError, handleCLIError, requireRexDir } from "../../../src/cli/errors.js";

describe("CLIError", () => {
  it("stores message and suggestion", () => {
    const err = new CLIError("something broke", "try this instead");
    expect(err.message).toBe("something broke");
    expect(err.suggestion).toBe("try this instead");
    expect(err.name).toBe("CLIError");
  });

  it("works without a suggestion", () => {
    const err = new CLIError("something broke");
    expect(err.message).toBe("something broke");
    expect(err.suggestion).toBeUndefined();
    expect(err.code).toBe(CLI_ERROR_CODES.GENERIC);
  });

  it("is an instance of Error", () => {
    const err = new CLIError("test");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("BudgetExceededError", () => {
  it("has exitCode 2 to distinguish from general errors", () => {
    const err = new BudgetExceededError(["token limit exceeded"]);
    expect(err.exitCode).toBe(2);
  });

  it("formats warnings into message", () => {
    const err = new BudgetExceededError(["token limit exceeded", "cost limit exceeded"]);
    expect(err.message).toContain("token limit exceeded");
    expect(err.message).toContain("cost limit exceeded");
  });

  it("includes budget adjustment suggestion", () => {
    const err = new BudgetExceededError(["exceeded"]);
    expect(err.suggestion).toContain("budget");
  });

  it("is an instance of CLIError", () => {
    const err = new BudgetExceededError([]);
    expect(err).toBeInstanceOf(CLIError);
    expect(err.name).toBe("BudgetExceededError");
  });
});

describe("formatCLIError", () => {
  it("formats CLIError with suggestion", () => {
    const err = new CLIError("File missing", "Run init first", CLI_ERROR_CODES.PRD_NOT_FOUND);
    const result = formatCLIError(err);
    expect(result).toBe(`Error: [${CLI_ERROR_CODES.PRD_NOT_FOUND}] File missing\nHint: Run init first`);
  });

  it("formats CLIError without suggestion", () => {
    const err = new CLIError("Something failed");
    const result = formatCLIError(err);
    expect(result).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] Something failed`);
  });

  it("never includes stack traces for Error instances", () => {
    const err = new Error("kaboom");
    const result = formatCLIError(err);
    expect(result).not.toContain("at ");
    expect(result).not.toContain(".ts:");
    expect(result).not.toContain(".js:");
    expect(result).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] kaboom`);
  });

  it("handles non-Error values", () => {
    expect(formatCLIError("string error")).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] string error`);
    expect(formatCLIError(42)).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] 42`);
    expect(formatCLIError(null)).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] null`);
    expect(formatCLIError(undefined)).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] undefined`);
  });

  it("matches ENOENT .rex pattern", () => {
    const err = new Error("ENOENT: no such file or directory, open '/tmp/.rex/prd.json'");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.NOT_INITIALIZED}]`);
    expect(result).toContain("Rex directory not found");
    expect(result).toContain("Hint:");
    expect(result).toContain("n-dx init");
  });

  it("matches ENOENT prd.json pattern", () => {
    const err = new Error("ENOENT: no such file or directory, open 'prd.json'");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.PRD_NOT_FOUND}]`);
    expect(result).toContain("PRD file not found");
    expect(result).toContain("Hint:");
  });

  it("matches Invalid prd.json pattern", () => {
    const err = new Error("Invalid prd.json: missing required field 'schema'");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.INVALID_PRD}]`);
    expect(result).toContain("corrupted or has an invalid format");
    expect(result).toContain("Hint:");
  });

  it("matches EACCES pattern", () => {
    const err = new Error("EACCES: permission denied, open '/tmp/.rex/config.json'");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.PERMISSION_DENIED}]`);
    expect(result).toContain("Permission denied");
    expect(result).toContain("Hint:");
  });

  it("matches Unexpected token (JSON parse) pattern", () => {
    const err = new Error("Unexpected token } in JSON at position 42");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.JSON_PARSE_FAILED}]`);
    expect(result).toContain("parse JSON");
    expect(result).toContain("Hint:");
  });

  it("matches 'not found' pattern with original message", () => {
    const err = new Error('Item "abc-123" not found');
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.RESOURCE_NOT_FOUND}]`);
    expect(result).toContain('Item "abc-123" not found');
    expect(result).toContain("Hint:");
  });

  it("falls back to generic message for unknown errors", () => {
    const err = new Error("some weird internal error");
    const result = formatCLIError(err);
    expect(result).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] some weird internal error`);
    expect(result).not.toContain("Hint:");
  });
});

describe("formatCLIError — verbose mode", () => {
  afterEach(() => {
    setVerbose(false);
  });

  it("suppresses stack trace in non-verbose mode", () => {
    const err = new Error("api call failed");
    const result = formatCLIError(err);
    expect(result).not.toContain("Stack trace:");
    expect(result).not.toContain("at ");
  });

  it("appends stack trace in verbose mode", () => {
    setVerbose(true);
    const err = new Error("api call failed");
    const result = formatCLIError(err);
    expect(result).toContain("Stack trace:");
    expect(result).toContain("Error: api call failed");
  });

  it("appends raw response body in verbose mode", () => {
    setVerbose(true);
    const err = new Error("Claude API error 429: {\"error\":\"rate limit\"}");
    const result = formatCLIError(err);
    expect(result).toContain("Raw response:");
    expect(result).toContain("rate limit");
  });

  it("verbose output appended after main error line", () => {
    setVerbose(true);
    const err = new Error("api error");
    const result = formatCLIError(err);
    const lines = result.split("\n");
    // First line is the error summary
    expect(lines[0]).toContain(`[${CLI_ERROR_CODES.GENERIC}]`);
    // Verbose details appear on subsequent lines
    expect(result).toContain("Stack trace:");
  });

  it("appends verbose details to CLIError in verbose mode", () => {
    setVerbose(true);
    const err = new CLIError("timed out", "retry the request", CLI_ERROR_CODES.TIMEOUT);
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.TIMEOUT}]`);
    expect(result).toContain("Stack trace:");
  });

  it("non-Error values do not trigger verbose details even in verbose mode", () => {
    setVerbose(true);
    const result = formatCLIError("plain string error");
    // Plain strings aren't Error instances — no stack trace possible
    expect(result).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] plain string error`);
    expect(result).not.toContain("Stack trace:");
  });
});

describe("handleCLIError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints formatted error and exits with code 1", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockStderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const err = new CLIError("test error", "try something");

    handleCLIError(err);

    expect(mockStderr).toHaveBeenCalledWith(`Error: [${CLI_ERROR_CODES.GENERIC}] test error\nHint: try something`);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("respects custom exitCode on CLIError subclasses", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockStderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const err = new BudgetExceededError(["token limit exceeded"]);

    handleCLIError(err);

    expect(mockStderr).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it("exits with code 1 for plain Error objects", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockStderr = vi.spyOn(console, "error").mockImplementation(() => {});

    handleCLIError(new Error("plain error"));

    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe("requireRexDir", () => {
  it("throws CLIError when .rex/ does not exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rex-test-"));
    try {
      expect(() => requireRexDir(tmp)).toThrow(CLIError);
      expect(() => requireRexDir(tmp)).toThrow(/Rex directory not found/);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("includes n-dx init suggestion in the error", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rex-test-"));
    try {
      let caught: CLIError | undefined;
      try {
        requireRexDir(tmp);
      } catch (err) {
        caught = err as CLIError;
      }
      expect(caught).toBeInstanceOf(CLIError);
      expect(caught!.suggestion).toContain("n-dx init");
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("does not throw when .rex/ exists", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rex-test-"));
    mkdirSync(join(tmp, ".rex"));
    try {
      expect(() => requireRexDir(tmp)).not.toThrow();
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });
});

// ── Yellow color regression tests ─────────────────────────────────────────────
//
// Verify that Hint lines render yellow in TTY mode (FORCE_COLOR=1) and
// produce plain text in NO_COLOR mode. Tests exercise the colorWarn()
// wrapping added to renderCLIError().

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
    const err = new CLIError("File missing", "Run init first", CLI_ERROR_CODES.PRD_NOT_FOUND);
    const result = formatCLIError(err);
    // Hint line must contain the ANSI yellow open code (\x1b[33m)
    const hintLine = result.split("\n")[1];
    expect(hintLine).toContain("\x1b[33m");
  });

  it("Hint line resets color after the suggestion text", () => {
    const err = new CLIError("File missing", "Run init first", CLI_ERROR_CODES.PRD_NOT_FOUND);
    const result = formatCLIError(err);
    const hintLine = result.split("\n")[1];
    // Must end with a color reset to avoid bleed into subsequent output
    expect(hintLine).toContain("\x1b[39m");
  });

  it("ENOENT pattern hint renders yellow", () => {
    const err = new Error("ENOENT: no such file or directory, open '/tmp/.rex/prd.json'");
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
    const err = new CLIError("File missing", "Run init first", CLI_ERROR_CODES.PRD_NOT_FOUND);
    const result = formatCLIError(err);
    expect(result).not.toContain("\x1b[");
    expect(result).toContain("Hint: Run init first");
  });
});
