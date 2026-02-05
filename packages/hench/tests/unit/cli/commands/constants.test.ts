import { describe, it, expect } from "vitest";
import { CLIError } from "../../../../src/cli/errors.js";
import { safeParseInt } from "../../../../src/cli/commands/constants.js";

describe("safeParseInt", () => {
  it("returns the parsed integer for valid values", () => {
    expect(safeParseInt("1", "iterations")).toBe(1);
    expect(safeParseInt("10", "max-turns")).toBe(10);
    expect(safeParseInt("100", "last")).toBe(100);
  });

  it("throws CLIError for non-numeric values", () => {
    expect(() => safeParseInt("abc", "iterations")).toThrow(CLIError);
    expect(() => safeParseInt("abc", "iterations")).toThrow(/Invalid --iterations/);
    expect(() => safeParseInt("", "iterations")).toThrow(CLIError);
    expect(() => safeParseInt("  ", "iterations")).toThrow(CLIError);
  });

  it("throws CLIError for zero", () => {
    expect(() => safeParseInt("0", "max-turns")).toThrow(CLIError);
    expect(() => safeParseInt("0", "max-turns")).toThrow(/Invalid --max-turns/);
  });

  it("throws CLIError for negative values", () => {
    expect(() => safeParseInt("-1", "last")).toThrow(CLIError);
    expect(() => safeParseInt("-1", "last")).toThrow(/Invalid --last/);
  });

  it("includes the invalid value in the error message", () => {
    expect(() => safeParseInt("abc", "iterations")).toThrow('"abc"');
  });

  it("includes positive integer suggestion", () => {
    try {
      safeParseInt("0", "max-turns");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("positive integer");
    }
  });
});
