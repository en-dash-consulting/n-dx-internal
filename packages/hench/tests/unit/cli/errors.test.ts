import { describe, it, expect, vi, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLIError, formatCLIError, handleCLIError, requireHenchDir } from "../../../src/cli/errors.js";

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
    const err = new CLIError("File missing", "Run init first");
    expect(formatCLIError(err)).toBe("Error: File missing\nHint: Run init first");
  });

  it("never includes stack traces", () => {
    const err = new Error("kaboom");
    const result = formatCLIError(err);
    expect(result).not.toContain("at ");
    expect(result).toBe("Error: kaboom");
  });

  it("handles non-Error values", () => {
    expect(formatCLIError("string error")).toBe("Error: string error");
  });

  it("matches ENOENT .hench pattern", () => {
    const err = new Error("ENOENT: no such file, open '/tmp/.hench/config.json'");
    const result = formatCLIError(err);
    expect(result).toContain("Hench directory not found");
    expect(result).toContain("Hint:");
  });

  it("matches ENOENT .rex pattern", () => {
    const err = new Error("ENOENT: no such file, open '/tmp/.rex/prd.json'");
    const result = formatCLIError(err);
    expect(result).toContain("Rex directory not found");
    expect(result).toContain("Hint:");
  });

  it("matches claude not found pattern", () => {
    const err = new Error("claude: not found");
    const result = formatCLIError(err);
    expect(result).toContain("Claude CLI not found");
    expect(result).toContain("Hint:");
  });

  it("matches ANTHROPIC_API_KEY pattern", () => {
    const err = new Error("Missing ANTHROPIC_API_KEY environment variable");
    const result = formatCLIError(err);
    expect(result).toContain("API key not configured");
    expect(result).toContain("Hint:");
  });

  it("falls back to generic message for unknown errors", () => {
    const err = new Error("some weird internal error");
    expect(formatCLIError(err)).toBe("Error: some weird internal error");
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

    expect(mockStderr).toHaveBeenCalledWith("Error: test error\nHint: try something");
    expect(mockExit).toHaveBeenCalledWith(1);
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
