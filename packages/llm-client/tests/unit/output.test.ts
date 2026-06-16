import { describe, it, expect, beforeEach, vi } from "vitest";
import { setQuiet, isQuiet, setVerbose, isVerbose, info, result } from "../../src/output.js";

describe("output", () => {
  beforeEach(() => {
    setQuiet(false);
    setVerbose(false);
  });

  describe("setQuiet / isQuiet", () => {
    it("defaults to not quiet", () => {
      expect(isQuiet()).toBe(false);
    });

    it("enables quiet mode", () => {
      setQuiet(true);
      expect(isQuiet()).toBe(true);
    });

    it("disables quiet mode", () => {
      setQuiet(true);
      setQuiet(false);
      expect(isQuiet()).toBe(false);
    });
  });

  describe("info", () => {
    it("prints when not quiet", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      info("hello");
      expect(spy).toHaveBeenCalledWith("hello");
      spy.mockRestore();
    });

    it("suppresses when quiet", () => {
      setQuiet(true);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      info("hello");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("result", () => {
    it("prints when not quiet", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      result("data");
      expect(spy).toHaveBeenCalledWith("data");
      spy.mockRestore();
    });

    it("prints even when quiet", () => {
      setQuiet(true);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      result("data");
      expect(spy).toHaveBeenCalledWith("data");
      spy.mockRestore();
    });
  });

  describe("setVerbose / isVerbose", () => {
    it("defaults to not verbose", () => {
      expect(isVerbose()).toBe(false);
    });

    it("enables verbose mode", () => {
      setVerbose(true);
      expect(isVerbose()).toBe(true);
    });

    it("disables verbose mode", () => {
      setVerbose(true);
      setVerbose(false);
      expect(isVerbose()).toBe(false);
    });

    it("is independent of quiet mode", () => {
      setQuiet(true);
      setVerbose(true);
      expect(isQuiet()).toBe(true);
      expect(isVerbose()).toBe(true);
    });
  });
});
