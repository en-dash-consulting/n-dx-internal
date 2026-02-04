import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { toolGit } from "../../../src/tools/git.js";

describe("toolGit", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-git-"));
    execSync("git init", { cwd: projectDir });
    execSync("git config user.email 'test@test.com'", { cwd: projectDir });
    execSync("git config user.name 'Test'", { cwd: projectDir });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("runs git status", async () => {
    const result = await toolGit(projectDir, { subcommand: "status" });
    expect(result).toContain("branch");
  });

  it("rejects disallowed subcommands", async () => {
    await expect(
      toolGit(projectDir, { subcommand: "push" }),
    ).rejects.toThrow("not allowed");
  });

  it("rejects destructive subcommands", async () => {
    await expect(
      toolGit(projectDir, { subcommand: "push" }),
    ).rejects.toThrow();
    await expect(
      toolGit(projectDir, { subcommand: "reset" }),
    ).rejects.toThrow();
  });

  it("runs git rev-parse", async () => {
    const result = await toolGit(projectDir, {
      subcommand: "rev-parse",
      args: "--git-dir",
    });
    expect(result).toContain(".git");
  });
});
