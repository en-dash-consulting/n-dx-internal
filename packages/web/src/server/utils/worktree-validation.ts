/**
 * Worktree validation for session-scoped MCP endpoints.
 *
 * Validates that a candidate root directory is:
 *   1. An absolute path
 *   2. A valid git worktree (or the primary repo root)
 *   3. Contains initialized .rex/ and .sourcevision/ directories
 *
 * Used by MCP route handlers when the X-Ndx-Root-Dir header is present.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

// ── Error types ──────────────────────────────────────────────────────────────

/**
 * Identifies which validation check failed.
 *
 * - `path_not_absolute` — the supplied path is not absolute
 * - `path_not_found` — the path does not exist or is not a directory
 * - `not_git_repo` — no .git file or directory found at the path
 * - `not_valid_worktree` — .git exists but is not the primary repo or a linked worktree
 * - `missing_rex` — .rex/ directory not found
 * - `missing_sourcevision` — .sourcevision/ directory not found
 */
export type WorktreeValidationField =
  | "path_not_absolute"
  | "path_not_found"
  | "not_git_repo"
  | "not_valid_worktree"
  | "missing_rex"
  | "missing_sourcevision";

/** Structured error returned when validation fails. */
export interface WorktreeValidationError {
  /** Human-readable error message. */
  message: string;
  /** Machine-readable field identifying which check failed. */
  field: WorktreeValidationField;
}

/** Discriminated union: validation either succeeds with a resolved path or fails with an error. */
export type WorktreeValidationResult =
  | { ok: true; rootDir: string }
  | { ok: false; error: WorktreeValidationError };

// ── Dependency injection for testability ─────────────────────────────────────

/**
 * File system + git operations used by the validator.
 * Defaults use real implementations; tests inject stubs.
 */
export interface WorktreeValidationDeps {
  existsSync: (p: string) => boolean;
  statSync: (p: string) => { isDirectory(): boolean };
  readFileSync: (p: string, encoding: BufferEncoding) => string;
  /**
   * Execute `git worktree list --porcelain` and return stdout.
   * Throws if git is not available or the command fails.
   */
  gitWorktreeList: (cwd: string) => string;
}

const defaultDeps: WorktreeValidationDeps = {
  existsSync,
  statSync,
  readFileSync,
  gitWorktreeList: (cwd: string) =>
    execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd,
      encoding: "utf-8",
      timeout: 5_000,
    }),
};

// ── Core validation ──────────────────────────────────────────────────────────

/**
 * Validate a candidate worktree root directory.
 *
 * @param candidatePath — The path to validate (from X-Ndx-Root-Dir header).
 * @param primaryRepoDir — Absolute path to the primary (main) repository root
 *                          that the server was started from. Used to verify the
 *                          candidate belongs to the same repository.
 * @param deps — Injectable dependencies for testing.
 * @returns A discriminated result: `{ ok: true, rootDir }` or `{ ok: false, error }`.
 */
export function validateWorktreeDir(
  candidatePath: string,
  primaryRepoDir: string,
  deps: WorktreeValidationDeps = defaultDeps,
): WorktreeValidationResult {
  // ── 1. Absolute path check ──────────────────────────────────────────────
  if (!isAbsolute(candidatePath)) {
    return {
      ok: false,
      error: {
        field: "path_not_absolute",
        message: `X-Ndx-Root-Dir must be an absolute path, got: ${candidatePath}`,
      },
    };
  }

  const resolved = resolve(candidatePath);

  // ── 2. Existence + directory check ──────────────────────────────────────
  if (!deps.existsSync(resolved)) {
    return {
      ok: false,
      error: {
        field: "path_not_found",
        message: `X-Ndx-Root-Dir path does not exist: ${resolved}`,
      },
    };
  }

  try {
    const stat = deps.statSync(resolved);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        error: {
          field: "path_not_found",
          message: `X-Ndx-Root-Dir is not a directory: ${resolved}`,
        },
      };
    }
  } catch {
    return {
      ok: false,
      error: {
        field: "path_not_found",
        message: `Cannot stat X-Ndx-Root-Dir: ${resolved}`,
      },
    };
  }

  // ── 3. Git repository check ─────────────────────────────────────────────
  const gitPath = join(resolved, ".git");
  if (!deps.existsSync(gitPath)) {
    return {
      ok: false,
      error: {
        field: "not_git_repo",
        message: `No .git found at ${resolved} — not a git repository or worktree`,
      },
    };
  }

  // ── 4. Worktree validation ──────────────────────────────────────────────
  // Primary repo: .git is a directory → check that it is the same repo.
  // Worktree: .git is a file containing "gitdir: <path>" → verify via git worktree list.
  const isGitDir = isDirectorySafe(gitPath, deps);

  if (isGitDir) {
    // This looks like a primary repo root. Verify it matches the server's primary repo.
    if (resolve(resolved) !== resolve(primaryRepoDir)) {
      return {
        ok: false,
        error: {
          field: "not_valid_worktree",
          message: `${resolved} is a git repository but not a worktree of ${primaryRepoDir}`,
        },
      };
    }
  } else {
    // .git is a file — should be a linked worktree. Parse and verify.
    const worktreeOk = isLinkedWorktreeOf(resolved, primaryRepoDir, deps);
    if (!worktreeOk) {
      return {
        ok: false,
        error: {
          field: "not_valid_worktree",
          message: `${resolved} is not a valid git worktree of ${primaryRepoDir}`,
        },
      };
    }
  }

  // ── 5. Initialized directories check ────────────────────────────────────
  if (!deps.existsSync(join(resolved, ".rex"))) {
    return {
      ok: false,
      error: {
        field: "missing_rex",
        message: `${resolved} does not contain an initialized .rex/ directory`,
      },
    };
  }

  if (!deps.existsSync(join(resolved, ".sourcevision"))) {
    return {
      ok: false,
      error: {
        field: "missing_sourcevision",
        message: `${resolved} does not contain an initialized .sourcevision/ directory`,
      },
    };
  }

  return { ok: true, rootDir: resolved };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Safe directory check — returns false if the path does not exist or stat throws. */
function isDirectorySafe(
  p: string,
  deps: WorktreeValidationDeps,
): boolean {
  try {
    return deps.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Determine whether `candidateDir` is a linked git worktree of `primaryRepoDir`.
 *
 * Strategy (two-pass, most-specific first):
 *   1. Parse the .git file to extract the gitdir path, verify it points inside
 *      the primary repo's .git/worktrees/ directory.
 *   2. Fall back to `git worktree list --porcelain` from the primary repo and
 *      check that the candidate is one of the listed worktree paths.
 */
function isLinkedWorktreeOf(
  candidateDir: string,
  primaryRepoDir: string,
  deps: WorktreeValidationDeps,
): boolean {
  // ── Pass 1: .git file parse ─────────────────────────────────────────────
  try {
    const gitFileContent = deps.readFileSync(join(candidateDir, ".git"), "utf-8").trim();
    // Expected format: "gitdir: /absolute/path/to/.git/worktrees/<name>"
    const match = gitFileContent.match(/^gitdir:\s+(.+)$/);
    if (match) {
      const gitdir = resolve(candidateDir, match[1]);
      const primaryGitDir = join(resolve(primaryRepoDir), ".git", "worktrees");
      if (gitdir.startsWith(primaryGitDir + "/")) {
        return true;
      }
    }
  } catch {
    // .git file unreadable — fall through to pass 2
  }

  // ── Pass 2: git worktree list ───────────────────────────────────────────
  try {
    const output = deps.gitWorktreeList(primaryRepoDir);
    const worktreePaths = parseWorktreeListPorcelain(output);
    const normalizedCandidate = resolve(candidateDir);
    return worktreePaths.some((wt) => resolve(wt) === normalizedCandidate);
  } catch {
    // git not available or command failed — cannot verify
    return false;
  }
}

/**
 * Parse the output of `git worktree list --porcelain`.
 *
 * Porcelain format outputs blocks separated by blank lines, each starting with
 * "worktree <path>". Returns an array of absolute worktree paths.
 */
function parseWorktreeListPorcelain(output: string): string[] {
  const paths: string[] = [];
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.push(line.slice("worktree ".length));
    }
  }
  return paths;
}
