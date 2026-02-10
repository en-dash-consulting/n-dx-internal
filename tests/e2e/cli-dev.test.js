import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../cli.js");

function runResult(args) {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: "pipe",
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    return { stdout: err.stdout || "", stderr: err.stderr || "", code: err.status };
  }
}

describe("n-dx dev", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-dev-e2e-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
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
      const output = execFileSync("node", [CLI_PATH], {
        encoding: "utf-8",
        timeout: 10000,
        stdio: "pipe",
      });
      expect(output).toContain("dev");
      expect(output).toContain("live reload");
    });
  });
});
