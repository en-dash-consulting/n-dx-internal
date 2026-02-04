import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setQuiet, isQuiet, info, result, section, subsection, stream, detail } from "../../../src/cli/output.js";

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

  describe("section()", () => {
    it("prints a section header with rules", () => {
      section("My Section");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("═");
      expect(output).toContain("❯ My Section");
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      section("My Section");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("subsection()", () => {
    it("prints a subsection header with dashes", () => {
      subsection("Turn 1/10");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("── Turn 1/10 ");
      expect(output).toContain("─");
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      subsection("Turn 1/10");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("stream()", () => {
    it("prints a labelled line with padded tag", () => {
      stream("Agent", "Hello world");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("[Agent]");
      expect(output).toContain("Hello world");
    });

    it("pads short labels for alignment", () => {
      stream("Tool", "read_file(…)");
      const output = logSpy.mock.calls[0][0] as string;
      // [Tool] is 6 chars, padded to 10, so there's whitespace before the text
      expect(output).toMatch(/\[Tool\]\s+read_file/);
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      stream("Agent", "Hello world");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("detail()", () => {
    it("prints indented detail text", () => {
      detail("42ms");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("42ms");
      // Should be indented to align with stream content
      expect(output).toMatch(/^\s+42ms$/);
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      detail("42ms");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
