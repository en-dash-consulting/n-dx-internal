import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdPrMarkdown } from "../../src/cli/commands/pr-markdown.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

describe("pr-markdown reviewer-first default output", () => {
  let tmpDir: string;

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("renders an Important Changes narrative and avoids file/line enumerations", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sv-pr-markdown-integration-"));
    vi.spyOn(console, "log").mockImplementation(() => {});

    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });
    mkdirSync(join(tmpDir, "src"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);

    writeFileSync(
      join(tmpDir, "src", "api.ts"),
      "export function fetchProfile() {\n  return \"v1\";\n}\n",
      "utf-8",
    );
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "base"]);

    git(tmpDir, ["checkout", "-b", "feature/reviewer-first-pr-markdown"]);

    writeFileSync(
      join(tmpDir, "src", "api.ts"),
      "export function fetchProfile() {\n  if (Math.random() > 0.5) return \"v2\";\n  return \"v1\";\n}\n",
      "utf-8",
    );

    const extraFiles = [
      "packages/alpha/index.ts",
      "packages/beta/index.ts",
      "apps/web/route.ts",
      "apps/admin/dashboard.tsx",
      "services/auth/handler.ts",
      "tests/pr-markdown/smoke.test.ts",
    ];

    for (const filePath of extraFiles) {
      mkdirSync(join(tmpDir, dirname(filePath)), { recursive: true });
      writeFileSync(join(tmpDir, filePath), "export const x = 1;\n", "utf-8");
    }

    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "mixed workstream updates"]);

    cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(markdown).toContain("## Important Changes");
    expect(markdown).toContain("Modified exported function `fetchProfile`");

    // Guard against reverting to noisy file-by-file or line-count summaries.
    expect(markdown).not.toContain("## Scope of Work");
    expect(markdown).not.toContain("## Notable Changes");
    expect(markdown).not.toContain("## Workstream Breakdown");
    expect(markdown).not.toContain("| Status | Path | + | - |");
    expect(markdown).not.toMatch(/^- `[^`]+`: \d+ file\(s\), \+\d+ \/ -\d+/m);
  });

  it("keeps semantic diff extraction stable when local external diff and textconv are enabled", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sv-pr-markdown-integration-"));
    vi.spyOn(console, "log").mockImplementation(() => {});

    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);

    writeFileSync(join(tmpDir, ".gitignore"), ".sourcevision/\n", "utf-8");
    writeFileSync(join(tmpDir, ".gitattributes"), "*.txt diff=poison\n", "utf-8");
    writeFileSync(join(tmpDir, "feature.txt"), "alpha\nbeta\n", "utf-8");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "base"]);

    git(tmpDir, ["checkout", "-b", "feature/deterministic-diff"]);
    writeFileSync(join(tmpDir, "feature.txt"), "alpha\nbeta\nrelease\n", "utf-8");
    git(tmpDir, ["add", "feature.txt"]);
    git(tmpDir, ["commit", "-m", "feature update"]);

    cmdPrMarkdown(tmpDir);
    const baselineMarkdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");

    const poisonLog = join(tmpDir, ".sourcevision", "poisoned-git-tools.log");
    const externalDiffScript = join(tmpDir, ".sourcevision", "external-diff.sh");
    const textconvScript = join(tmpDir, ".sourcevision", "textconv.sh");

    writeFileSync(
      externalDiffScript,
      `#!/bin/sh
echo "external-diff:$@" >> "${poisonLog}"
echo "poisoned diff output"
exit 0
`,
      "utf-8",
    );
    chmodSync(externalDiffScript, 0o755);

    writeFileSync(
      textconvScript,
      `#!/bin/sh
echo "textconv:$@" >> "${poisonLog}"
cat "$1"
`,
      "utf-8",
    );
    chmodSync(textconvScript, 0o755);

    git(tmpDir, ["config", "diff.external", externalDiffScript]);
    git(tmpDir, ["config", "diff.poison.textconv", textconvScript]);

    cmdPrMarkdown(tmpDir);
    const deterministicMarkdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");

    expect(deterministicMarkdown).toBe(baselineMarkdown);
    const poisonInvocations = (() => {
      try {
        return readFileSync(poisonLog, "utf-8");
      } catch {
        return "";
      }
    })();
    expect(poisonInvocations).toBe("");
  });
});
