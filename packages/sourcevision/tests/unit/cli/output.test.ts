import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setQuiet, isQuiet, info, result } from "../../../src/cli/output.js";

describe("CLI output", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    setQuiet(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    setQuiet(false);
  });

  describe("setQuiet / isQuiet", () => {
    it("defaults to non-quiet", () => {
      expect(isQuiet()).toBe(false);
    });

    it("can enable quiet mode", () => {
      setQuiet(true);
      expect(isQuiet()).toBe(true);
    });
  });

  describe("info()", () => {
    it("prints when not quiet", () => {
      info("hello");
      expect(logSpy).toHaveBeenCalledWith("hello");
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      info("hello");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("result()", () => {
    it("always prints", () => {
      setQuiet(true);
      result("essential");
      expect(logSpy).toHaveBeenCalledWith("essential");
    });
  });
});
