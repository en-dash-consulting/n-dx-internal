import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  validateWorktreeDir,
  type WorktreeValidationDeps,
  type WorktreeValidationField,
} from "../../../src/server/utils/worktree-validation.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

const PRIMARY_REPO = "/repo/primary";

/** Build a deps object with sane defaults for a valid worktree. */
function makeDeps(overrides: Partial<WorktreeValidationDeps> = {}): WorktreeValidationDeps {
  return {
    existsSync: () => true,
    statSync: () => ({ isDirectory: () => true }),
    readFileSync: () => `gitdir: ${PRIMARY_REPO}/.git/worktrees/my-wt`,
    gitWorktreeList: () => "",
    ...overrides,
  };
}

/** Shorthand to assert a validation failure and return the error for further assertions. */
function expectFailure(
  candidatePath: string,
  primaryRepo: string,
  deps: WorktreeValidationDeps,
  expectedField: WorktreeValidationField,
) {
  const result = validateWorktreeDir(candidatePath, primaryRepo, deps);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.field).toBe(expectedField);
    expect(result.error.message).toBeTruthy();
    return result.error;
  }
  throw new Error("expected failure");
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("worktree-validation", () => {
  describe("path_not_absolute", () => {
    it("rejects relative paths", () => {
      const deps = makeDeps();
      expectFailure("relative/path", PRIMARY_REPO, deps, "path_not_absolute");
    });

    it("rejects dot-relative paths", () => {
      const deps = makeDeps();
      expectFailure("./relative/path", PRIMARY_REPO, deps, "path_not_absolute");
    });

    it("includes the offending path in the error message", () => {
      const deps = makeDeps();
      const err = expectFailure("not-absolute", PRIMARY_REPO, deps, "path_not_absolute");
      expect(err.message).toContain("not-absolute");
    });
  });

  describe("path_not_found", () => {
    it("rejects non-existent paths", () => {
      const deps = makeDeps({
        existsSync: (p: string) => !p.endsWith("/gone"),
      });
      expectFailure("/gone", PRIMARY_REPO, deps, "path_not_found");
    });

    it("rejects paths that are not directories", () => {
      const deps = makeDeps({
        statSync: () => ({ isDirectory: () => false }),
      });
      expectFailure("/some/file.txt", PRIMARY_REPO, deps, "path_not_found");
    });

    it("rejects when statSync throws", () => {
      const deps = makeDeps({
        statSync: () => { throw new Error("EPERM"); },
      });
      expectFailure("/no-perm", PRIMARY_REPO, deps, "path_not_found");
    });
  });

  describe("not_git_repo", () => {
    it("rejects paths without a .git file or directory", () => {
      const deps = makeDeps({
        existsSync: (p: string) => !p.endsWith(".git"),
      });
      expectFailure("/not-a-repo", PRIMARY_REPO, deps, "not_git_repo");
    });

    it("error message mentions .git", () => {
      const deps = makeDeps({
        existsSync: (p: string) => !p.endsWith(".git"),
      });
      const err = expectFailure("/not-a-repo", PRIMARY_REPO, deps, "not_git_repo");
      expect(err.message).toContain(".git");
    });
  });

  describe("not_valid_worktree", () => {
    it("rejects a primary repo that is not the server primary", () => {
      // .git is a directory (primary repo), but a different repo entirely
      const deps = makeDeps({
        existsSync: () => true,
        statSync: (p: string) => ({
          isDirectory: () => {
            // Return true for everything — the .git path is a directory
            return true;
          },
        }),
        readFileSync: () => { throw new Error("is a directory"); },
      });
      expectFailure("/other/repo", PRIMARY_REPO, deps, "not_valid_worktree");
    });

    it("rejects when .git file points to a different repo", () => {
      const deps = makeDeps({
        existsSync: () => true,
        statSync: (p: string) => ({
          isDirectory: () => !p.endsWith(".git"),
        }),
        readFileSync: () => "gitdir: /completely/different/repo/.git/worktrees/wt",
        gitWorktreeList: () => "",
      });
      expectFailure("/some/worktree", PRIMARY_REPO, deps, "not_valid_worktree");
    });

    it("rejects when .git file is malformed and path not in worktree list", () => {
      const deps = makeDeps({
        existsSync: () => true,
        statSync: (p: string) => ({
          isDirectory: () => !p.endsWith(".git"),
        }),
        readFileSync: () => "not a valid gitdir line",
        gitWorktreeList: () => `worktree ${PRIMARY_REPO}\n\n`,
      });
      expectFailure("/some/worktree", PRIMARY_REPO, deps, "not_valid_worktree");
    });

    it("rejects when git worktree list command fails and .git file fails", () => {
      const deps = makeDeps({
        existsSync: () => true,
        statSync: (p: string) => ({
          isDirectory: () => !p.endsWith(".git"),
        }),
        readFileSync: () => { throw new Error("ENOENT"); },
        gitWorktreeList: () => { throw new Error("git not found"); },
      });
      expectFailure("/some/worktree", PRIMARY_REPO, deps, "not_valid_worktree");
    });
  });

  describe("missing_rex", () => {
    it("rejects when .rex/ directory is absent", () => {
      const candidate = "/repo/worktree";
      const deps = makeDeps({
        existsSync: (p: string) => {
          if (p === join(candidate, ".rex")) return false;
          return true;
        },
        statSync: (p: string) => ({
          isDirectory: () => !p.endsWith(".git"),
        }),
        readFileSync: () => `gitdir: ${PRIMARY_REPO}/.git/worktrees/wt`,
      });
      expectFailure(candidate, PRIMARY_REPO, deps, "missing_rex");
    });
  });

  describe("missing_sourcevision", () => {
    it("rejects when .sourcevision/ directory is absent", () => {
      const candidate = "/repo/worktree";
      const deps = makeDeps({
        existsSync: (p: string) => {
          if (p === join(candidate, ".sourcevision")) return false;
          return true;
        },
        statSync: (p: string) => ({
          isDirectory: () => !p.endsWith(".git"),
        }),
        readFileSync: () => `gitdir: ${PRIMARY_REPO}/.git/worktrees/wt`,
      });
      expectFailure(candidate, PRIMARY_REPO, deps, "missing_sourcevision");
    });
  });

  describe("valid worktree paths", () => {
    it("accepts a linked worktree identified via .git file", () => {
      const candidate = "/repo/worktree";
      const deps = makeDeps({
        existsSync: () => true,
        statSync: (p: string) => ({
          isDirectory: () => !p.endsWith(".git"),
        }),
        readFileSync: () => `gitdir: ${PRIMARY_REPO}/.git/worktrees/my-wt`,
      });
      const result = validateWorktreeDir(candidate, PRIMARY_REPO, deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rootDir).toBe(candidate);
      }
    });

    it("accepts a linked worktree identified via git worktree list fallback", () => {
      const candidate = "/repo/worktree";
      const porcelain = [
        `worktree ${PRIMARY_REPO}`,
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        `worktree ${candidate}`,
        "HEAD def456",
        "branch refs/heads/feature",
        "",
      ].join("\n");

      const deps = makeDeps({
        existsSync: () => true,
        statSync: (p: string) => ({
          isDirectory: () => !p.endsWith(".git"),
        }),
        readFileSync: () => "gitdir: malformed-content",
        gitWorktreeList: () => porcelain,
      });
      const result = validateWorktreeDir(candidate, PRIMARY_REPO, deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rootDir).toBe(candidate);
      }
    });

    it("accepts the primary repo itself", () => {
      const deps = makeDeps({
        existsSync: () => true,
        statSync: () => ({ isDirectory: () => true }),
      });
      const result = validateWorktreeDir(PRIMARY_REPO, PRIMARY_REPO, deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rootDir).toBe(PRIMARY_REPO);
      }
    });
  });

  describe("error structure", () => {
    it("returns structured error with field and message", () => {
      const deps = makeDeps();
      const result = validateWorktreeDir("relative", PRIMARY_REPO, deps);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toHaveProperty("field");
        expect(result.error).toHaveProperty("message");
        expect(typeof result.error.field).toBe("string");
        expect(typeof result.error.message).toBe("string");
      }
    });

    it("checks run in order: path → git → worktree → directories", () => {
      // If path is relative, we never reach git checks
      const deps = makeDeps({
        existsSync: () => { throw new Error("should not be called"); },
      });
      const result = validateWorktreeDir("relative", PRIMARY_REPO, deps);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe("path_not_absolute");
      }
    });
  });

  describe("edge cases", () => {
    it("handles .git file with relative gitdir path", () => {
      // Some git versions may use relative paths in .git file
      const candidate = "/repo/worktree";
      const deps = makeDeps({
        existsSync: () => true,
        statSync: (p: string) => ({
          isDirectory: () => !p.endsWith(".git"),
        }),
        // Relative gitdir that resolves to primary repo's .git/worktrees/
        readFileSync: () => `gitdir: ../../.git/worktrees/my-wt`,
        gitWorktreeList: () => `worktree ${PRIMARY_REPO}\n\nworktree ${candidate}\n\n`,
      });
      // The .git file parse may fail (relative path won't match primary's .git/worktrees/
      // unless it resolves correctly), but the fallback to worktree list should succeed
      const result = validateWorktreeDir(candidate, PRIMARY_REPO, deps);
      expect(result.ok).toBe(true);
    });

    it("normalizes paths with trailing slashes", () => {
      const deps = makeDeps({
        existsSync: () => true,
        statSync: () => ({ isDirectory: () => true }),
      });
      // resolve() strips trailing slash
      const result = validateWorktreeDir(PRIMARY_REPO + "/", PRIMARY_REPO, deps);
      expect(result.ok).toBe(true);
    });

    it("handles .git file with extra whitespace", () => {
      const candidate = "/repo/worktree";
      const deps = makeDeps({
        existsSync: () => true,
        statSync: (p: string) => ({
          isDirectory: () => !p.endsWith(".git"),
        }),
        readFileSync: () => `gitdir:   ${PRIMARY_REPO}/.git/worktrees/my-wt  \n`,
      });
      const result = validateWorktreeDir(candidate, PRIMARY_REPO, deps);
      expect(result.ok).toBe(true);
    });
  });
});
