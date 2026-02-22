import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CLIError, requireSvDir } from "../errors.js";
import { SV_DIR } from "./constants.js";
import { info } from "../output.js";

const OUTPUT_FILENAME = "pr-markdown.md";
const SCOPE_AREAS_LIMIT = 3;
const NOTABLE_CHANGES_LIMIT = 4;
const SHOUTOUTS_LIMIT = 3;
const WORKSTREAM_BREAKDOWN_LIMIT = 8;

interface GitChangedFile {
  status: string;
  path: string;
  additions: number;
  deletions: number;
}

interface WorkingTreeState {
  unstagedModifiedFiles: string[];
  untrackedFiles: string[];
}

type GitResult =
  | { ok: true; output: string }
  | { ok: false; reason: "missing-git" | "not-a-repo" | "failed" };

function runGit(projectDir: string, args: string[]): GitResult {
  try {
    const output = execFileSync("git", args, {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { ok: true, output };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string | Buffer; status?: number };
    if (err.code === "ENOENT") return { ok: false, reason: "missing-git" };

    const stderrRaw = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf-8") ?? "";
    const stderr = stderrRaw.toLowerCase();
    if (stderr.includes("not a git repository")) return { ok: false, reason: "not-a-repo" };
    if (err.status === 128 && stderr.includes("outside repository")) return { ok: false, reason: "not-a-repo" };
    return { ok: false, reason: "failed" };
  }
}

function gitOutput(projectDir: string, args: string[]): string | null {
  const result = runGit(projectDir, args);
  return result.ok ? result.output : null;
}

function hasCommitRef(projectDir: string, ref: string): boolean {
  return gitOutput(projectDir, ["rev-parse", "--verify", `${ref}^{commit}`]) !== null;
}

function resolveComparisonRange(projectDir: string): string | null {
  if (hasCommitRef(projectDir, "main")) return "main...HEAD";
  if (hasCommitRef(projectDir, "origin/main")) return "origin/main...HEAD";
  return null;
}

function parseNum(value: string): number {
  if (value === "-") return 0;
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : 0;
}

function parseNameStatusLine(line: string): { status: string; path: string } | null {
  const parts = line.split("\t");
  if (parts.length < 2) return null;

  const code = parts[0] ?? "";
  const status = code.charAt(0);
  if (!status) return null;

  if (status === "R" || status === "C") {
    const renamedPath = parts[2];
    if (!renamedPath) return null;
    return { status, path: renamedPath };
  }

  const path = parts[1];
  if (!path) return null;
  return { status, path };
}

function parseWorkingTreePath(rawPath: string): string {
  const renameIdx = rawPath.indexOf(" -> ");
  if (renameIdx >= 0) return rawPath.slice(renameIdx + 4);
  return rawPath;
}

function getWorkingTreeState(projectDir: string): WorkingTreeState | null {
  const status = gitOutput(projectDir, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status == null) return null;

  const unstagedModified = new Set<string>();
  const untracked = new Set<string>();

  if (status.length > 0) {
    for (const line of status.split("\n")) {
      if (!line || line.length < 3) continue;
      const indexStatus = line[0] ?? " ";
      const workTreeStatus = line[1] ?? " ";
      const rawPath = line.slice(3).trim();
      if (!rawPath) continue;
      const path = parseWorkingTreePath(rawPath);

      if (indexStatus === "?" && workTreeStatus === "?") {
        untracked.add(path);
        continue;
      }

      if (workTreeStatus !== " " && workTreeStatus !== "?") {
        unstagedModified.add(path);
      }
    }
  }

  return {
    unstagedModifiedFiles: [...unstagedModified].sort((a, b) => a.localeCompare(b)),
    untrackedFiles: [...untracked].sort((a, b) => a.localeCompare(b)),
  };
}

function getChangedFilesForRange(projectDir: string, range: string): GitChangedFile[] | null {
  const nameStatus = gitOutput(projectDir, ["diff", "--name-status", range]);
  const numStat = gitOutput(projectDir, ["diff", "--numstat", range]);
  if (nameStatus == null || numStat == null) return null;

  const statsByPath = new Map<string, { additions: number; deletions: number }>();
  if (numStat.length > 0) {
    for (const line of numStat.split("\n")) {
      if (!line) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const path = parts[parts.length - 1];
      if (!path) continue;
      statsByPath.set(path, {
        additions: parseNum(parts[0] ?? "0"),
        deletions: parseNum(parts[1] ?? "0"),
      });
    }
  }

  const files: GitChangedFile[] = [];
  if (nameStatus.length > 0) {
    for (const line of nameStatus.split("\n")) {
      if (!line) continue;
      const parsed = parseNameStatusLine(line);
      if (!parsed) continue;
      const stat = statsByPath.get(parsed.path) ?? { additions: 0, deletions: 0 };
      files.push({
        status: parsed.status,
        path: parsed.path,
        additions: stat.additions,
        deletions: stat.deletions,
      });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

interface ScopeArea {
  area: string;
  files: number;
}

interface WorkstreamSummary {
  workstream: string;
  files: number;
  additions: number;
  deletions: number;
  addedFiles: number;
  renamedFiles: number;
  deletedFiles: number;
  modifiedFiles: number;
}

function computeScopeAreas(files: readonly GitChangedFile[]): ScopeArea[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const slashIdx = file.path.indexOf("/");
    const area = slashIdx > 0 ? file.path.slice(0, slashIdx) : "(root)";
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([area, fileCount]) => ({ area, files: fileCount }))
    .sort((a, b) => {
      if (a.files !== b.files) return b.files - a.files;
      return a.area.localeCompare(b.area);
    });
}

function getWorkstream(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "(root)";

  const [head, second] = parts;
  if (head === "packages" && second) return `packages/${second}`;
  if (head === "apps" && second) return `apps/${second}`;
  if (head === "services" && second) return `services/${second}`;
  if (head === "docs" || head === "tests") return head;
  return head;
}

function computeWorkstreamSummaries(files: readonly GitChangedFile[]): WorkstreamSummary[] {
  const byWorkstream = new Map<string, WorkstreamSummary>();

  for (const file of files) {
    const workstream = getWorkstream(file.path);
    const existing = byWorkstream.get(workstream) ?? {
      workstream,
      files: 0,
      additions: 0,
      deletions: 0,
      addedFiles: 0,
      renamedFiles: 0,
      deletedFiles: 0,
      modifiedFiles: 0,
    };

    existing.files += 1;
    existing.additions += file.additions;
    existing.deletions += file.deletions;

    if (file.status === "A") existing.addedFiles += 1;
    else if (file.status === "R") existing.renamedFiles += 1;
    else if (file.status === "D") existing.deletedFiles += 1;
    else existing.modifiedFiles += 1;

    byWorkstream.set(workstream, existing);
  }

  return [...byWorkstream.values()].sort((a, b) => {
    const churnA = a.additions + a.deletions;
    const churnB = b.additions + b.deletions;
    if (churnA !== churnB) return churnB - churnA;
    if (a.files !== b.files) return b.files - a.files;
    return a.workstream.localeCompare(b.workstream);
  });
}

function formatWorkstreamMix(summary: WorkstreamSummary): string {
  const parts: string[] = [];
  if (summary.addedFiles > 0) parts.push(`${summary.addedFiles} added`);
  if (summary.modifiedFiles > 0) parts.push(`${summary.modifiedFiles} modified`);
  if (summary.renamedFiles > 0) parts.push(`${summary.renamedFiles} renamed`);
  if (summary.deletedFiles > 0) parts.push(`${summary.deletedFiles} deleted`);
  return parts.length === 0 ? "no status details" : parts.join(", ");
}

function limitedItems<T>(items: readonly T[], limit: number): { items: readonly T[]; total: number } {
  return { items: items.slice(0, limit), total: items.length };
}

function pushTruncationNote(lines: string[], shown: number, total: number): void {
  if (total <= shown) return;
  lines.push(`- _Truncated: showing top ${shown} of ${total} items._`);
}

function renderPRMarkdown(
  range: string,
  files: readonly GitChangedFile[],
  workingTree: WorkingTreeState | null,
): string {
  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const scopeAreas = limitedItems(computeScopeAreas(files), SCOPE_AREAS_LIMIT);
  const workstreams = computeWorkstreamSummaries(files);
  const notable = limitedItems(workstreams, NOTABLE_CHANGES_LIMIT);
  const shoutouts = limitedItems(
    workstreams
    .filter((workstream) => workstream.addedFiles > 0 || workstream.renamedFiles > 0)
    .sort((a, b) => {
      const signalA = a.addedFiles + a.renamedFiles;
      const signalB = b.addedFiles + b.renamedFiles;
      if (signalA !== signalB) return signalB - signalA;
      return (b.additions - b.deletions) - (a.additions - a.deletions);
    }),
    SHOUTOUTS_LIMIT,
  );
  const workstreamBreakdown = limitedItems(workstreams, WORKSTREAM_BREAKDOWN_LIMIT);

  const lines: string[] = [];
  lines.push("## Scope of Work");
  lines.push("");
  if (files.length === 0) {
    lines.push("- No scope items identified for this comparison.");
  } else {
    lines.push(`- Base comparison: \`${range}\``);
    lines.push(`- Change size: ${files.length} file(s), +${totalAdditions} / -${totalDeletions}`);
    lines.push("- Primary areas:");
    for (const area of scopeAreas.items) {
      lines.push(`- \`${area.area}\` (${area.files} file${area.files === 1 ? "" : "s"})`);
    }
    pushTruncationNote(lines, scopeAreas.items.length, scopeAreas.total);
  }

  lines.push("");
  lines.push("## Notable Changes");
  lines.push("");

  if (notable.items.length === 0) {
    lines.push("- No notable changes identified.");
  } else {
    for (const summary of notable.items) {
      const churn = summary.additions + summary.deletions;
      lines.push(
        `- \`${summary.workstream}\`: ${summary.files} file(s), +${summary.additions} / -${summary.deletions} (${churn} lines changed; ${formatWorkstreamMix(summary)}).`,
      );
    }
    pushTruncationNote(lines, notable.items.length, notable.total);
  }

  lines.push("");
  lines.push("## Shoutouts");
  lines.push("");

  if (shoutouts.items.length === 0) {
    lines.push("- No shoutouts identified from this diff.");
  } else {
    for (const summary of shoutouts.items) {
      const shoutoutParts: string[] = [];
      if (summary.addedFiles > 0) shoutoutParts.push(`${summary.addedFiles} new file${summary.addedFiles === 1 ? "" : "s"}`);
      if (summary.renamedFiles > 0) shoutoutParts.push(`${summary.renamedFiles} renamed`);
      lines.push(
        `- \`${summary.workstream}\`: ${shoutoutParts.join(" and ")} (+${summary.additions} / -${summary.deletions}).`,
      );
    }
    pushTruncationNote(lines, shoutouts.items.length, shoutouts.total);
  }
  lines.push("");
  lines.push("## Workstream Breakdown");
  lines.push("");

  if (workstreamBreakdown.items.length === 0) {
    lines.push("- No workstreams identified.");
  } else {
    for (const summary of workstreamBreakdown.items) {
      lines.push(
        `- \`${summary.workstream}\`: ${summary.files} file(s), +${summary.additions} / -${summary.deletions} (${formatWorkstreamMix(summary)}).`,
      );
    }
    pushTruncationNote(lines, workstreamBreakdown.items.length, workstreamBreakdown.total);
  }

  lines.push("");
  lines.push("## Modified But Unstaged Files");
  lines.push("");

  const unstagedModified = workingTree?.unstagedModifiedFiles ?? [];
  if (unstagedModified.length === 0) {
    lines.push("- None.");
  } else {
    for (const path of unstagedModified) {
      lines.push(`- \`${path}\``);
    }
  }

  lines.push("");
  lines.push("## Untracked Files");
  lines.push("");

  const untracked = workingTree?.untrackedFiles ?? [];
  if (untracked.length === 0) {
    lines.push("- None.");
  } else {
    for (const path of untracked) {
      lines.push(`- \`${path}\``);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function cmdPrMarkdown(targetDir: string): void {
  const absDir = resolve(targetDir);
  requireSvDir(absDir);
  const repoCheck = runGit(absDir, ["rev-parse", "--is-inside-work-tree"]);
  if (!repoCheck.ok) {
    if (repoCheck.reason === "missing-git") {
      throw new CLIError(
        "Git is not available on PATH.",
        "Install git and run 'sourcevision pr-markdown' again.",
      );
    }
    if (repoCheck.reason === "not-a-repo") {
      throw new CLIError(
        "This directory is not a git repository.",
        "Run this command in a git repository with a .sourcevision/ directory.",
      );
    }
    throw new CLIError("Git commands failed unexpectedly.", "Verify repository access and try again.");
  }

  if (repoCheck.output !== "true") {
    throw new CLIError(
      "This directory is not a git repository.",
      "Run this command in a git repository with a .sourcevision/ directory.",
    );
  }

  const comparisonRange = resolveComparisonRange(absDir);
  if (!comparisonRange) {
    throw new CLIError(
      "Could not resolve a base branch (`main` or `origin/main`).",
      "Create/fetch one of those refs, then run 'sourcevision pr-markdown' again.",
    );
  }

  const changedFiles = getChangedFilesForRange(absDir, comparisonRange);
  if (!changedFiles) {
    throw new CLIError(
      `Failed to compute git diff for '${comparisonRange}'.`,
      "Ensure git history is accessible and try again.",
    );
  }

  const workingTree = getWorkingTreeState(absDir);
  const markdown = renderPRMarkdown(comparisonRange, changedFiles, workingTree);
  const outputPath = join(absDir, SV_DIR, OUTPUT_FILENAME);
  writeFileSync(outputPath, markdown, "utf-8");
  info(`PR markdown regenerated → ${outputPath}`);
}
