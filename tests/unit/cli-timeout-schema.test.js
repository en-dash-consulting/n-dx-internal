import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateTimeoutMs, validateResponseTimeoutMs } from "../../packages/core/config.js";

describe("validateTimeoutMs", () => {
  it("accepts a valid positive timeout", () => {
    expect(() => validateTimeoutMs(1800000)).not.toThrow();
    expect(() => validateTimeoutMs(3600000)).not.toThrow();
    expect(() => validateTimeoutMs(14400000)).not.toThrow();
  });

  it("accepts zero (disables timeout)", () => {
    expect(() => validateTimeoutMs(0)).not.toThrow();
  });

  it("rejects negative values with a descriptive error", () => {
    expect(() => validateTimeoutMs(-1)).toThrow("non-negative");
    expect(() => validateTimeoutMs(-1000)).toThrow("non-negative");
  });

  it("includes the offending value in the negative-value error", () => {
    expect(() => validateTimeoutMs(-500)).toThrow("-500");
  });

  it("rejects NaN", () => {
    expect(() => validateTimeoutMs(NaN)).toThrow("number in milliseconds");
  });

  it("rejects non-numeric types (string, null, undefined)", () => {
    expect(() => validateTimeoutMs("1800000")).toThrow("number in milliseconds");
    expect(() => validateTimeoutMs(null)).toThrow("number in milliseconds");
    expect(() => validateTimeoutMs(undefined)).toThrow("number in milliseconds");
  });

  it("rejects Infinity", () => {
    expect(() => validateTimeoutMs(Infinity)).toThrow("number in milliseconds");
    expect(() => validateTimeoutMs(-Infinity)).toThrow("number in milliseconds");
  });
});

describe("validateResponseTimeoutMs", () => {
  it("accepts a valid positive timeout", () => {
    expect(() => validateResponseTimeoutMs(300000)).not.toThrow();
    expect(() => validateResponseTimeoutMs(600000)).not.toThrow();
    expect(() => validateResponseTimeoutMs(1)).not.toThrow();
  });

  it("rejects zero with a descriptive error", () => {
    expect(() => validateResponseTimeoutMs(0)).toThrow("positive");
  });

  it("rejects negative values with a descriptive error", () => {
    expect(() => validateResponseTimeoutMs(-1)).toThrow("positive");
    expect(() => validateResponseTimeoutMs(-1000)).toThrow("positive");
  });

  it("rejects NaN", () => {
    expect(() => validateResponseTimeoutMs(NaN)).toThrow("number in milliseconds");
  });

  it("rejects non-numeric types (string, null, undefined)", () => {
    expect(() => validateResponseTimeoutMs("300000")).toThrow("number in milliseconds");
    expect(() => validateResponseTimeoutMs(null)).toThrow("number in milliseconds");
    expect(() => validateResponseTimeoutMs(undefined)).toThrow("number in milliseconds");
  });

  it("rejects Infinity", () => {
    expect(() => validateResponseTimeoutMs(Infinity)).toThrow("number in milliseconds");
    expect(() => validateResponseTimeoutMs(-Infinity)).toThrow("number in milliseconds");
  });
});

describe("llm.responseTimeout config wiring regression", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ndx-llm-timeout-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loadLLMConfig returns responseTimeout when set in .n-dx.json", async () => {
    await writeFile(
      join(dir, ".n-dx.json"),
      JSON.stringify({ llm: { responseTimeout: 600000 } }),
    );
    const { loadLLMConfig } = await import("../../packages/llm-client/dist/llm-config.js");
    const config = await loadLLMConfig(dir);
    expect(config.responseTimeout).toBe(600000);
  });

  it("loadLLMConfig returns undefined responseTimeout when not set in .n-dx.json", async () => {
    await writeFile(
      join(dir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude" } }),
    );
    const { loadLLMConfig } = await import("../../packages/llm-client/dist/llm-config.js");
    const config = await loadLLMConfig(dir);
    expect(config.responseTimeout).toBeUndefined();
  });

  it("loadLLMConfig ignores llm.responseTimeout of 0 (non-positive)", async () => {
    await writeFile(
      join(dir, ".n-dx.json"),
      JSON.stringify({ llm: { responseTimeout: 0 } }),
    );
    const { loadLLMConfig } = await import("../../packages/llm-client/dist/llm-config.js");
    const config = await loadLLMConfig(dir);
    // 0 is not > 0, so it's ignored and responseTimeout stays undefined
    expect(config.responseTimeout).toBeUndefined();
  });
});
