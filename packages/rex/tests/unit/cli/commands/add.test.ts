import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLIError } from "../../../../src/cli/errors.js";
import { cmdAdd } from "../../../../src/cli/commands/add.js";

describe("cmdAdd", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-add-test-"));
    mkdirSync(join(tmp, ".rex"));
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "test",
        items: [],
      }),
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  it("throws CLIError for invalid level", async () => {
    await expect(cmdAdd(tmp, "bogus", { title: "test" })).rejects.toThrow(CLIError);
    await expect(cmdAdd(tmp, "bogus", { title: "test" })).rejects.toThrow(/Invalid level/);
  });

  it("includes valid levels in suggestion for invalid level", async () => {
    try {
      await cmdAdd(tmp, "bogus", { title: "test" });
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("epic");
      expect((err as CLIError).suggestion).toContain("task");
    }
  });

  it("throws CLIError when --title is missing", async () => {
    await expect(cmdAdd(tmp, "epic", {})).rejects.toThrow(CLIError);
    await expect(cmdAdd(tmp, "epic", {})).rejects.toThrow(/Missing required flag/);
  });

  it("throws CLIError when parent is required but missing", async () => {
    await expect(cmdAdd(tmp, "task", { title: "test" })).rejects.toThrow(CLIError);
    await expect(cmdAdd(tmp, "task", { title: "test" })).rejects.toThrow(/requires a parent/);
  });

  it("throws CLIError when parent is not found", async () => {
    await expect(
      cmdAdd(tmp, "task", { title: "test", parent: "nonexistent-id" }),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdAdd(tmp, "task", { title: "test", parent: "nonexistent-id" }),
    ).rejects.toThrow(/not found/);
  });

  it("includes suggestion to check status when parent not found", async () => {
    try {
      await cmdAdd(tmp, "task", { title: "test", parent: "nonexistent-id" });
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("rex status");
    }
  });

  it("succeeds for valid epic with title", async () => {
    await expect(cmdAdd(tmp, "epic", { title: "My Epic" })).resolves.toBeUndefined();
  });
});
