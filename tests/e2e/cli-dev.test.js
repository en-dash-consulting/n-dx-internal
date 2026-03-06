import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { run, runResult, createTmpDir, removeTmpDir } from "./e2e-helpers.js";

describe("n-dx dev", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTmpDir("ndx-dev-e2e-");
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  describe("prerequisite checks", () => {
    it("exits 1 when .sourcevision is missing", () => {
      const { stderr, code } = runResult(["dev", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain("Missing");
    });
  });

  describe("help text", () => {
    it("shows dev command in the main help output", () => {
      const output = run([]);
      expect(output).toContain("dev");
      expect(output).toContain("live reload");
    });
  });
});
