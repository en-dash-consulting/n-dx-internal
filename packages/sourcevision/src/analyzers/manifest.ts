/**
 * Manifest management — TypeScript port of common.sh manifest logic.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getCurrentHead, getCurrentBranch } from "@n-dx/llm-client";
import type { Manifest, ModuleStatus } from "../schema/index.js";
import { SV_DIR, TOOL_VERSION } from "../constants.js";

function getGitInfo(dir: string): { sha?: string; branch?: string } {
  return {
    sha: getCurrentHead(dir),
    branch: getCurrentBranch(dir),
  };
}

export function readManifest(dir: string): Manifest {
  const absDir = resolve(dir);
  const manifestPath = join(absDir, SV_DIR, "manifest.json");

  if (existsSync(manifestPath)) {
    const raw = readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as Manifest;
  }

  // Create a fresh manifest
  const git = getGitInfo(absDir);
  return {
    schemaVersion: "1.0.0",
    toolVersion: TOOL_VERSION,
    analyzedAt: new Date().toISOString(),
    ...(git.sha ? { gitSha: git.sha } : {}),
    ...(git.branch ? { gitBranch: git.branch } : {}),
    targetPath: absDir,
    modules: {},
  };
}

export function writeManifest(dir: string, manifest: Manifest): void {
  const absDir = resolve(dir);
  const svDir = join(absDir, SV_DIR);
  mkdirSync(svDir, { recursive: true });
  writeFileSync(join(svDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

export function updateManifestModule(
  dir: string,
  moduleName: string,
  status: ModuleStatus
): void {
  const manifest = readManifest(dir);
  const now = new Date().toISOString();

  manifest.analyzedAt = now;

  if (!manifest.modules[moduleName]) {
    manifest.modules[moduleName] = { status };
  } else {
    manifest.modules[moduleName].status = status;
  }

  if (status === "running") {
    manifest.modules[moduleName].startedAt = now;
    manifest.modules[moduleName].pid = process.pid;
  } else {
    manifest.modules[moduleName].completedAt = now;
    delete manifest.modules[moduleName].pid;
  }

  // Clear previous error on new run
  if (status === "running" || status === "complete") {
    delete manifest.modules[moduleName].error;
  }

  writeManifest(dir, manifest);
}

export function updateManifestError(
  dir: string,
  moduleName: string,
  error: string
): void {
  const manifest = readManifest(dir);
  const now = new Date().toISOString();

  if (!manifest.modules[moduleName]) {
    manifest.modules[moduleName] = { status: "error" };
  }

  manifest.modules[moduleName].status = "error";
  manifest.modules[moduleName].completedAt = now;
  manifest.modules[moduleName].error = error;
  delete manifest.modules[moduleName].pid;

  writeManifest(dir, manifest);
}

// ── Concurrency guard ─────────────────────────────────────────────────

/** Check whether a PID is still alive. signal 0 does not kill, only checks. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Result of an analysis-running check. */
export interface AnalysisRunningResult {
  /** Whether any module is actively running (after stale lock cleanup). */
  running: boolean;
  /** Module names that are actively running. */
  modules: string[];
  /** Whether stale locks were auto-cleared during the check. */
  staleCleared: boolean;
}

/**
 * Check whether any analysis module is currently running.
 *
 * Reads the manifest and finds modules with status "running".
 * If a running module has a recorded PID that is no longer alive,
 * it is considered a stale lock and automatically cleared to "error".
 *
 * This function is the single source of truth for cross-process
 * concurrency detection — used by CLI, server routes, and MCP tools.
 */
export function isAnalysisRunning(dir: string): AnalysisRunningResult {
  const manifestPath = join(resolve(dir), SV_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    return { running: false, modules: [], staleCleared: false };
  }

  const manifest = readManifest(dir);
  const runningModules: string[] = [];
  const staleModules: string[] = [];

  for (const [name, info] of Object.entries(manifest.modules ?? {})) {
    if (info.status !== "running") continue;

    // If a PID is recorded, check whether it is still alive
    if (info.pid && !isPidAlive(info.pid)) {
      staleModules.push(name);
    } else {
      runningModules.push(name);
    }
  }

  // Auto-clear stale locks
  if (staleModules.length > 0) {
    const now = new Date().toISOString();
    for (const name of staleModules) {
      manifest.modules[name].status = "error";
      manifest.modules[name].completedAt = now;
      manifest.modules[name].error = "Process exited unexpectedly (stale lock cleared)";
      delete manifest.modules[name].pid;
    }
    writeManifest(dir, manifest);
  }

  return {
    running: runningModules.length > 0,
    modules: runningModules,
    staleCleared: staleModules.length > 0,
  };
}

/**
 * Clear all modules in "running" state back to "error".
 *
 * Used as a cleanup handler on process exit to release locks
 * held by the current process.
 */
export function clearRunningModules(dir: string): void {
  const manifestPath = join(resolve(dir), SV_DIR, "manifest.json");
  if (!existsSync(manifestPath)) return;

  try {
    const manifest = readManifest(dir);
    const now = new Date().toISOString();
    let changed = false;

    for (const [, info] of Object.entries(manifest.modules)) {
      if (info.status === "running" && info.pid === process.pid) {
        info.status = "error";
        info.completedAt = now;
        info.error = "Process exited before phase completed";
        delete info.pid;
        changed = true;
      }
    }

    if (changed) {
      writeManifest(dir, manifest);
    }
  } catch {
    // Best-effort cleanup — don't throw during process exit
  }
}
