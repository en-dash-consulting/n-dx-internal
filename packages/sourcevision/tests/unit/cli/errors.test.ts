import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLI_ERROR_CODES, resetColorCache } from "@n-dx/llm-client";
import { CLIError, formatCLIError, handleCLIError, requireSvDir } from "../../../src/cli/errors.js";

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
    const err = new CLIError("File missing", "Run init first", CLI_ERROR_CODES.DIRECTORY_NOT_FOUND);
    expect(formatCLIError(err)).toBe(`Error: [${CLI_ERROR_CODES.DIRECTORY_NOT_FOUND}] File missing\nHint: Run init first`);
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

  it("matches ENOENT .sourcevision pattern", () => {
    const err = new Error("ENOENT: no such file, open '/tmp/.sourcevision/manifest.json'");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.NOT_INITIALIZED}]`);
    expect(result).toContain("Sourcevision directory not found");
    expect(result).toContain("Hint:");
  });

  it("matches EACCES pattern", () => {
    const err = new Error("EACCES: permission denied");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.PERMISSION_DENIED}]`);
    expect(result).toContain("Permission denied");
    expect(result).toContain("Hint:");
  });

  it("matches Unexpected token pattern", () => {
    const err = new Error("Unexpected token } in JSON at position 42");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.JSON_PARSE_FAILED}]`);
    expect(result).toContain("parse JSON");
    expect(result).toContain("Hint:");
  });

  it("falls back to generic message for unknown errors", () => {
    const err = new Error("some weird internal error");
    expect(formatCLIError(err)).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] some weird internal error`);
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

describe("requireSvDir", () => {
  it("throws CLIError when .sourcevision/ does not exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sv-test-"));
    try {
      expect(() => requireSvDir(tmp)).toThrow(CLIError);
      expect(() => requireSvDir(tmp)).toThrow(/Sourcevision directory not found/);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("includes n-dx init suggestion in the error", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sv-test-"));
    try {
      let caught: CLIError | undefined;
      try {
        requireSvDir(tmp);
      } catch (err) {
        caught = err as CLIError;
      }
      expect(caught).toBeInstanceOf(CLIError);
      expect(caught!.suggestion).toContain("n-dx init");
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("does not throw when .sourcevision/ exists", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sv-test-"));
    mkdirSync(join(tmp, ".sourcevision"));
    try {
      expect(() => requireSvDir(tmp)).not.toThrow();
    } finally {
      rmSync(tmp, { recursive: true });
    }
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
    const err = new CLIError("File missing", "Run sourcevision init first", CLI_ERROR_CODES.DIRECTORY_NOT_FOUND);
    const result = formatCLIError(err);
    const hintLine = result.split("\n")[1];
    expect(hintLine).toContain("\x1b[33m");
  });

  it("Hint line resets color after suggestion text", () => {
    const err = new CLIError("File missing", "Run sourcevision init first", CLI_ERROR_CODES.DIRECTORY_NOT_FOUND);
    const result = formatCLIError(err);
    const hintLine = result.split("\n")[1];
    expect(hintLine).toContain("\x1b[39m");
  });

  it("ENOENT .sourcevision pattern hint renders yellow", () => {
    const err = new Error("ENOENT: no such file, open '/tmp/.sourcevision/manifest.json'");
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
    const err = new CLIError("File missing", "Run sourcevision init first", CLI_ERROR_CODES.DIRECTORY_NOT_FOUND);
    const result = formatCLIError(err);
    expect(result).not.toContain("\x1b[");
    expect(result).toContain("Hint: Run sourcevision init first");
  });
});
