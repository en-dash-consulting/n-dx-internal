import { describe, it, expect } from "vitest";
import { DATA_FILES, ALL_DATA_FILES, SUPPLEMENTARY_FILES } from "../../../src/schema/data-files.js";

describe("DATA_FILES", () => {
  it("has all expected module keys", () => {
    expect(DATA_FILES).toHaveProperty("manifest");
    expect(DATA_FILES).toHaveProperty("inventory");
    expect(DATA_FILES).toHaveProperty("imports");
    expect(DATA_FILES).toHaveProperty("zones");
    expect(DATA_FILES).toHaveProperty("components");
  });

  it("all values are .json files", () => {
    for (const value of Object.values(DATA_FILES)) {
      expect(value).toMatch(/\.json$/);
    }
  });

  it("has no duplicate filenames", () => {
    const values = Object.values(DATA_FILES);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("ALL_DATA_FILES", () => {
  it("contains all DATA_FILES values", () => {
    for (const value of Object.values(DATA_FILES)) {
      expect(ALL_DATA_FILES).toContain(value);
    }
  });

  it("has same length as DATA_FILES entries", () => {
    expect(ALL_DATA_FILES).toHaveLength(Object.keys(DATA_FILES).length);
  });
});

describe("SUPPLEMENTARY_FILES", () => {
  it("includes llms.txt and CONTEXT.md", () => {
    expect(SUPPLEMENTARY_FILES).toContain("llms.txt");
    expect(SUPPLEMENTARY_FILES).toContain("CONTEXT.md");
  });
});
