import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdPrMarkdown } from "../../../src/cli/commands/pr-markdown.js";
import { CLIError } from "../../../src/cli/errors.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

describe("cmdPrMarkdown", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sv-pr-markdown-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when .sourcevision directory is missing", () => {
    expect(() => cmdPrMarkdown(tmpDir)).toThrow(CLIError);
    expect(() => cmdPrMarkdown(tmpDir)).toThrow(/Sourcevision directory not found/);
  });

  it("writes .sourcevision/pr-markdown.md when git diff can be generated", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);

    writeFileSync(join(tmpDir, "base.txt"), "base\n", "utf-8");
    git(tmpDir, ["add", "base.txt"]);
    git(tmpDir, ["commit", "-m", "base"]);

    git(tmpDir, ["checkout", "-b", "feature/add-pr-markdown"]);
    writeFileSync(join(tmpDir, "feature.txt"), "line1\nline2\n", "utf-8");
    git(tmpDir, ["add", "feature.txt"]);
    git(tmpDir, ["commit", "-m", "feature"]);

    writeFileSync(join(tmpDir, "base.txt"), "base\nchanged\n", "utf-8");
    writeFileSync(join(tmpDir, "scratch.tmp"), "temp\n", "utf-8");

    cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(markdown).toContain("## Scope of Work");
    expect(markdown).toContain("## Notable Changes");
    expect(markdown).toContain("## Shoutouts");
    expect(markdown).toContain("`main...HEAD`");
    expect(markdown).toContain("- `(root)`: 1 file(s), +2 / -0");
    expect(markdown).toContain("## Modified But Unstaged Files");
    expect(markdown).toContain("## Untracked Files");
    expect(markdown).toContain("`scratch.tmp`");
    expect(markdown).toContain("## Workstream Breakdown");
    expect(markdown).toContain("`(root)`");

    expect(markdown.indexOf("## Scope of Work")).toBeLessThan(markdown.indexOf("## Notable Changes"));
    expect(markdown.indexOf("## Notable Changes")).toBeLessThan(markdown.indexOf("## Shoutouts"));

    // Regression guard: old per-file table block should not be present.
    expect(markdown).not.toContain("## Changed Files");
    expect(markdown).not.toContain("| Status | Path | + | - |");
  });

  it("renders explicit fallback lines when scope, notable changes, and shoutouts are empty", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);
    writeFileSync(join(tmpDir, "file.txt"), "hello\n", "utf-8");
    git(tmpDir, ["add", "file.txt"]);
    git(tmpDir, ["commit", "-m", "init"]);

    git(tmpDir, ["checkout", "-b", "feature/no-diff"]);

    cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(markdown).toContain("## Scope of Work");
    expect(markdown).toContain("- No scope items identified for this comparison.");
    expect(markdown).toContain("## Notable Changes");
    expect(markdown).toContain("- No notable changes identified.");
    expect(markdown).toContain("## Shoutouts");
    expect(markdown).toContain("- No shoutouts identified from this diff.");
  });

  it("adds explicit truncation notes when summary sections exceed limits", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);
    writeFileSync(join(tmpDir, "base.txt"), "base\n", "utf-8");
    git(tmpDir, ["add", "base.txt"]);
    git(tmpDir, ["commit", "-m", "init"]);

    git(tmpDir, ["checkout", "-b", "feature/over-limit-sections"]);

    const changedFiles = [
      "packages/alpha/a.ts",
      "packages/beta/b.ts",
      "apps/web/a.ts",
      "apps/admin/b.ts",
      "services/api/a.ts",
      "services/auth/b.ts",
      "docs/readme.md",
      "tests/smoke.test.ts",
      "scripts/setup.sh",
    ];

    for (const relativePath of changedFiles) {
      mkdirSync(join(tmpDir, dirname(relativePath)), { recursive: true });
      writeFileSync(join(tmpDir, relativePath), "content\n", "utf-8");
    }

    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "add many workstreams"]);

    cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(markdown).toContain("- _Truncated: showing top 3 of 6 items._");
    expect(markdown).toContain("- _Truncated: showing top 4 of 9 items._");
    expect(markdown).toContain("- _Truncated: showing top 3 of 9 items._");
    expect(markdown).toContain("- _Truncated: showing top 8 of 9 items._");
  });

  it("fails when no main or origin/main base branch can be resolved", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "trunk"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);
    writeFileSync(join(tmpDir, "file.txt"), "hello\n", "utf-8");
    git(tmpDir, ["add", "file.txt"]);
    git(tmpDir, ["commit", "-m", "init"]);

    expect(() => cmdPrMarkdown(tmpDir)).toThrow(CLIError);
    expect(() => cmdPrMarkdown(tmpDir)).toThrow(/Could not resolve a base branch/);
  });
});
