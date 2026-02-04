import { describe, it, expect, vi, afterEach } from "vitest";
import { CLIError, formatCLIError, handleCLIError } from "../../../src/cli/errors.js";

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
