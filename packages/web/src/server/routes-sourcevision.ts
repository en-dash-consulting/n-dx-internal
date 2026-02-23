/**
 * Sourcevision API routes — structured access to analysis data.
 *
 * All endpoints are under /api/sv/.
 *
 * GET /api/sv/manifest      — analysis metadata and git info
 * GET /api/sv/inventory     — file listing with metadata
 * GET /api/sv/imports       — dependency graph
 * GET /api/sv/zones         — architectural zone map
 * GET /api/sv/components    — React component catalog
 * GET /api/sv/context       — full CONTEXT.md contents
 * GET /api/sv/pr-markdown   — latest PR markdown (if available)
 * GET /api/sv/summary       — summary stats across all analyses
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync, unlinkSync, utimesSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse } from "./types.js";
import { DATA_FILES } from "../schema/data-files.js";
import {
  buildPRMarkdownRefreshFailure,
  classifyPRMarkdownRefreshFailureCode,
  getPRMarkdownRefreshRemediationHints,
  resolvePRMarkdownRefreshPreflightErrorContract,
  resolvePRMarkdownRefreshGuidance,
  shouldUsePRMarkdownFallbackForCode,
  validatePRMarkdownRefreshPreflightErrorContract,
} from "./pr-markdown-refresh-diagnostics.js";

const SV_PREFIX = "/api/sv/";

/** Safely read and parse a JSON data file. Returns null on failure. */
function loadDataFile(ctx: ServerContext, filename: string): unknown | null {
  const filePath = join(ctx.svDir, filename);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/** Safely read a text data file. Returns null on failure. */
function loadTextFile(ctx: ServerContext, filename: string): string | null {
  const filePath = join(ctx.svDir, filename);
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

const PR_MARKDOWN_FILES = ["pr-markdown.md", "PR_MARKDOWN.md", "pr.md", "PR.md"] as const;
const PR_MARKDOWN_ARTIFACT_PAYLOAD_FILE = "pr-markdown.artifact.json";
const PR_MARKDOWN_STALE_MS = 30 * 60 * 1000;
const NON_INTERACTIVE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  GH_PROMPT_DISABLED: "1",
};

type PRMarkdownCacheStatus = "missing" | "fresh" | "stale";
type PRMarkdownMode = "normal" | "fallback";

interface PRMarkdownState {
  trackedFilesSignature: string | null;
  gitStatusSignature: string | null;
  gitDiffSignature: string | null;
  signature: string;
  availability: "ready" | "unsupported" | "no-repo" | "error";
  message: string | null;
  warning: string | null;
  baseRange: string | null;
  cacheStatus: PRMarkdownCacheStatus;
  generatedAt: string | null;
  staleAfterMs: number;
  mode: PRMarkdownMode;
  confidence?: number;
  coverage?: number;
}

interface PRMarkdownArtifactPayload {
  markdown: string;
  mode: PRMarkdownMode;
  confidence?: number;
  coverage?: number;
}

interface HenchRunFallbackArtifact {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  outcome: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

type RexWorkFallbackItemLevel = "epic" | "feature" | "task";

interface RexWorkFallbackItem {
  id: string;
  level: RexWorkFallbackItemLevel;
  title: string;
  status: string;
  completedAt: string | null;
}

interface PRMarkdownArtifactFallbackInput {
  project: string;
  totalFiles: number;
  totalZones: number;
  totalComponents: number;
  hasCallGraph: boolean;
  hasRexEvidence: boolean;
  rexWorkItems: RexWorkFallbackItem[];
  henchRuns: HenchRunFallbackArtifact[];
  metrics: PRMarkdownArtifactFallbackMetrics;
}

interface PRMarkdownArtifactFallbackMetrics {
  coveragePercent: number;
  confidenceScore: number;
  foundSources: string[];
  missingSources: string[];
  requiredMissingSources: string[];
}

interface FallbackEvidenceSourceSpec {
  id: string;
  label: string;
  required: boolean;
}

const FALLBACK_EVIDENCE_SOURCES: readonly FallbackEvidenceSourceSpec[] = [
  { id: "manifest", label: "SourceVision manifest", required: true },
  { id: "inventory", label: "SourceVision inventory", required: true },
  { id: "zones", label: "SourceVision zones", required: false },
  { id: "components", label: "SourceVision components", required: false },
  { id: "callgraph", label: "SourceVision call graph", required: false },
  { id: "rex", label: "Rex task evidence", required: false },
  { id: "hench", label: "Hench run evidence", required: false },
] as const;

function computePRMarkdownArtifactFallbackMetrics(
  sourcePresence: Record<string, boolean>,
): PRMarkdownArtifactFallbackMetrics {
  const foundSources = FALLBACK_EVIDENCE_SOURCES
    .filter((source) => sourcePresence[source.id])
    .map((source) => source.label);
  const missingSources = FALLBACK_EVIDENCE_SOURCES
    .filter((source) => !sourcePresence[source.id])
    .map((source) => source.label);
  const requiredMissingSources = FALLBACK_EVIDENCE_SOURCES
    .filter((source) => source.required && !sourcePresence[source.id])
    .map((source) => source.label);

  const expected = FALLBACK_EVIDENCE_SOURCES.length;
  const found = foundSources.length;
  const requiredTotal = FALLBACK_EVIDENCE_SOURCES.filter((source) => source.required).length;
  const requiredMissing = requiredMissingSources.length;
  const requiredFound = Math.max(0, requiredTotal - requiredMissing);
  const optionalFound = FALLBACK_EVIDENCE_SOURCES
    .filter((source) => !source.required && sourcePresence[source.id])
    .length;

  const coveragePercent = expected > 0 ? Math.round((found / expected) * 100) : 0;

  let confidenceScore = 35;
  confidenceScore += requiredFound * 20;
  confidenceScore += optionalFound * 5;
  if (sourcePresence.rex && sourcePresence.hench) confidenceScore += 10;
  confidenceScore -= requiredMissing * 15;
  confidenceScore = Math.max(0, Math.min(100, confidenceScore));

  return {
    coveragePercent,
    confidenceScore,
    foundSources,
    missingSources,
    requiredMissingSources,
  };
}

function toOptionalPercentage(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.round(value);
  if (normalized < 0 || normalized > 100) return undefined;
  return normalized;
}

function parsePRMarkdownArtifactPayload(raw: unknown): PRMarkdownArtifactPayload | null {
  const data = toRecord(raw);
  if (!data) return null;
  const markdown = asNonEmptyString(data.markdown);
  if (!markdown) return null;
  const mode = data.mode === "fallback" ? "fallback" : data.mode === "normal" ? "normal" : null;
  if (!mode) return null;
  const confidence = mode === "fallback" ? toOptionalPercentage(data.confidence) : undefined;
  const coverage = mode === "fallback" ? toOptionalPercentage(data.coverage) : undefined;
  return {
    markdown,
    mode,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
  };
}

function loadPRMarkdownArtifactPayload(ctx: ServerContext): PRMarkdownArtifactPayload | null {
  const artifactPath = join(ctx.svDir, PR_MARKDOWN_ARTIFACT_PAYLOAD_FILE);
  if (!existsSync(artifactPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(artifactPath, "utf-8"));
    return parsePRMarkdownArtifactPayload(parsed);
  } catch {
    return null;
  }
}

function writePRMarkdownArtifactPayload(ctx: ServerContext, payload: PRMarkdownArtifactPayload): void {
  const artifactPath = join(ctx.svDir, PR_MARKDOWN_ARTIFACT_PAYLOAD_FILE);
  const normalized: Record<string, unknown> = {
    markdown: payload.markdown,
    mode: payload.mode,
  };
  if (payload.mode === "fallback") {
    if (payload.confidence !== undefined) normalized.confidence = payload.confidence;
    if (payload.coverage !== undefined) normalized.coverage = payload.coverage;
  }
  try {
    writeFileSync(artifactPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  } catch {
    // Best-effort cache metadata persistence.
  }
}

function clearPRMarkdownArtifactPayload(ctx: ServerContext): void {
  const artifactPath = join(ctx.svDir, PR_MARKDOWN_ARTIFACT_PAYLOAD_FILE);
  if (!existsSync(artifactPath)) return;
  try {
    unlinkSync(artifactPath);
  } catch {
    // Ignore cleanup failures and preserve refresh response semantics.
  }
}

type GitCommandResult =
  | { ok: true; output: string }
  | { ok: false; reason: "missing-git" | "not-a-repo" | "failed" };

interface ProcessErrorContext {
  details: string;
  stderr?: string;
  exitCode?: number | null;
}

function formatProcessErrorContext(error: unknown, fallback: string): ProcessErrorContext {
  if (!(error instanceof Error)) {
    return { details: fallback, exitCode: null };
  }
  const err = error as NodeJS.ErrnoException & { stderr?: string | Buffer; status?: number };
  const stderrRaw = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf-8") ?? "";
  const stderr = stderrRaw.trim();
  const message = err.message?.trim();
  return {
    details: stderr.length > 0
      ? stderr
      : message && message.length > 0
        ? message
        : fallback,
    ...(stderr.length > 0 ? { stderr } : {}),
    ...(typeof err.status === "number" ? { exitCode: err.status } : { exitCode: null }),
  };
}

interface PRMarkdownRefreshOptions {
  credentialHelperOptIn?: boolean;
}

function runSourcevisionCommand(
  ctx: ServerContext,
  args: string[],
  envOverrides?: NodeJS.ProcessEnv,
): void {
  const svBin = join(ctx.projectDir, "node_modules", ".bin", "sourcevision");
  const env = envOverrides ? { ...process.env, ...envOverrides } : process.env;

  if (existsSync(svBin)) {
    execFileSync(svBin, args, {
      cwd: ctx.projectDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      env,
    });
    return;
  }

  const bundledCli = resolve(import.meta.dirname, "../../../sourcevision/dist/cli/index.js");
  if (existsSync(bundledCli)) {
    execFileSync("node", [bundledCli, ...args], {
      cwd: ctx.projectDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      env,
    });
    return;
  }

  execFileSync("sourcevision", args, {
    cwd: ctx.projectDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    env,
  });
}

function runPRMarkdownRefresh(ctx: ServerContext, options: PRMarkdownRefreshOptions = {}): void {
  const args = ["pr-markdown", ctx.projectDir];
  if (options.credentialHelperOptIn) {
    runSourcevisionCommand(ctx, ["git-credential-helper"]);
  }
  runSourcevisionCommand(ctx, args, NON_INTERACTIVE_GIT_ENV);
}

/** Run git and return trimmed output, or null when unavailable. */
function gitOutput(ctx: ServerContext, args: string[]): string | null {
  const result = gitOutputResult(ctx, args);
  return result.ok ? result.output : null;
}

function gitOutputResult(ctx: ServerContext, args: string[]): GitCommandResult {
  try {
    const out = execFileSync("git", args, {
      cwd: ctx.projectDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { ok: true, output: out.length > 0 ? out : "" };
  } catch (error) {
    const code = classifyPRMarkdownRefreshFailureCode(error);
    if (code === "missing_git") return { ok: false, reason: "missing-git" };
    if (code === "not_repo") return { ok: false, reason: "not-a-repo" };
    return { ok: false, reason: "failed" };
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hasCommitRef(ctx: ServerContext, ref: string): boolean {
  return gitOutput(ctx, ["rev-parse", "--verify", `${ref}^{commit}`]) !== null;
}

function getPRComparisonRange(ctx: ServerContext): string | null {
  if (hasCommitRef(ctx, "main")) return "main...HEAD";
  if (hasCommitRef(ctx, "origin/main")) return "origin/main...HEAD";
  return null;
}

function getPRMarkdownFileSnapshot(ctx: ServerContext): {
  markdown: string | null;
  signature: string | null;
  generatedAt: string | null;
  cacheStatus: PRMarkdownCacheStatus;
  filePath: string | null;
  fileMtimeMs: number | null;
  mode: PRMarkdownMode;
  confidence?: number;
  coverage?: number;
} {
  const payload = loadPRMarkdownArtifactPayload(ctx);
  for (const fileName of PR_MARKDOWN_FILES) {
    const filePath = join(ctx.svDir, fileName);
    if (!existsSync(filePath)) continue;
    try {
      const markdown = readFileSync(filePath, "utf-8");
      const mtimeMs = statSync(filePath).mtimeMs;
      const generatedAt = Number.isFinite(mtimeMs) && mtimeMs > 0 ? new Date(mtimeMs).toISOString() : null;
      const cacheStatus = Date.now() - mtimeMs > PR_MARKDOWN_STALE_MS ? "stale" : "fresh";
      return {
        markdown,
        signature: digest(markdown),
        generatedAt,
        cacheStatus,
        filePath,
        fileMtimeMs: mtimeMs,
        mode: payload?.mode ?? "normal",
        ...(payload?.mode === "fallback" && payload.confidence !== undefined ? { confidence: payload.confidence } : {}),
        ...(payload?.mode === "fallback" && payload.coverage !== undefined ? { coverage: payload.coverage } : {}),
      };
    } catch {
      return {
        markdown: null,
        signature: null,
        generatedAt: null,
        cacheStatus: "missing",
        filePath,
        fileMtimeMs: null,
        mode: "normal",
      };
    }
  }
  if (payload) {
    const payloadPath = join(ctx.svDir, PR_MARKDOWN_ARTIFACT_PAYLOAD_FILE);
    let mtimeMs: number | null = null;
    try {
      mtimeMs = statSync(payloadPath).mtimeMs;
    } catch {
      mtimeMs = null;
    }
    const generatedAt = mtimeMs !== null && Number.isFinite(mtimeMs) && mtimeMs > 0 ? new Date(mtimeMs).toISOString() : null;
    const cacheStatus = mtimeMs !== null && Number.isFinite(mtimeMs) && Date.now() - mtimeMs > PR_MARKDOWN_STALE_MS
      ? "stale"
      : "fresh";
    return {
      markdown: payload.markdown,
      signature: digest(payload.markdown),
      generatedAt,
      cacheStatus,
      filePath: payloadPath,
      fileMtimeMs: mtimeMs,
      mode: payload.mode,
      ...(payload.mode === "fallback" && payload.confidence !== undefined ? { confidence: payload.confidence } : {}),
      ...(payload.mode === "fallback" && payload.coverage !== undefined ? { coverage: payload.coverage } : {}),
    };
  }
  return {
    markdown: null,
    signature: null,
    generatedAt: null,
    cacheStatus: "missing",
    filePath: null,
    fileMtimeMs: null,
    mode: "normal",
  };
}

function isSemanticDiffInspectionFailure(details: string, code: string | null): boolean {
  if (code !== "diff_failed") return false;
  return details.toLowerCase().includes("failed to inspect semantic diff details");
}

function restorePRMarkdownSnapshot(
  ctx: ServerContext,
  snapshot: { markdown: string | null; filePath: string | null; fileMtimeMs: number | null },
): void {
  const canonicalPath = join(ctx.svDir, "pr-markdown.md");
  const targetPath = snapshot.filePath ?? canonicalPath;

  try {
    if (snapshot.markdown != null) {
      writeFileSync(targetPath, snapshot.markdown, "utf-8");
      if (snapshot.fileMtimeMs != null && Number.isFinite(snapshot.fileMtimeMs) && snapshot.fileMtimeMs > 0) {
        const restoredTime = new Date(snapshot.fileMtimeMs);
        utimesSync(targetPath, restoredTime, restoredTime);
      }
      return;
    }
  } catch {
    // Best-effort restoration; degraded response still carries preserved cache metadata.
  }

  if (existsSync(canonicalPath)) {
    try {
      unlinkSync(canonicalPath);
    } catch {
      // Ignore cleanup failures and preserve degraded API response semantics.
    }
  }
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseHenchRunArtifact(raw: unknown, fallbackId: string | null): HenchRunFallbackArtifact | null {
  const data = toRecord(raw);
  if (!data) return null;

  const id = asNonEmptyString(data.id) ?? fallbackId;
  if (!id) return null;

  return {
    id,
    taskId: asNonEmptyString(data.taskId),
    taskTitle: asNonEmptyString(data.taskTitle),
    outcome: asNonEmptyString(data.status) ?? asNonEmptyString(data.outcome),
    startedAt: asNonEmptyString(data.startedAt),
    finishedAt: asNonEmptyString(data.finishedAt),
  };
}

function resolveCurrentBranch(ctx: ServerContext): string | null {
  const branch = gitOutput(ctx, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") return null;
  return branch;
}

function resolveRexLogEntryBranch(entry: Record<string, unknown>): string | null {
  const context = toRecord(entry.context);
  const git = toRecord(entry.git);
  const metadata = toRecord(entry.metadata);
  const candidate =
    asNonEmptyString(entry.branch)
    ?? asNonEmptyString(entry.branchName)
    ?? asNonEmptyString(entry.gitBranch)
    ?? asNonEmptyString(context?.branch)
    ?? asNonEmptyString(git?.branch)
    ?? asNonEmptyString(metadata?.branch);
  return candidate;
}

function collectBranchScopedRexTaskIds(ctx: ServerContext, branch: string): Set<string> {
  const logPath = join(ctx.rexDir, "execution-log.jsonl");
  if (!existsSync(logPath)) return new Set();

  let raw: string;
  try {
    raw = readFileSync(logPath, "utf-8");
  } catch {
    return new Set();
  }

  const taskIds = new Set<string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = toRecord(JSON.parse(trimmed));
      if (!entry) continue;
      const itemId = asNonEmptyString(entry.itemId);
      if (!itemId) continue;
      const entryBranch = resolveRexLogEntryBranch(entry);
      if (entryBranch !== branch) continue;
      taskIds.add(itemId);
    } catch {
      // Ignore malformed JSONL lines to keep fallback generation deterministic.
    }
  }
  return taskIds;
}

interface IndexedRexWorkItem {
  id: string;
  level: string;
  title: string;
  status: string;
  completedAt: string | null;
  parentId?: string;
}

function indexRexWorkItems(
  items: readonly unknown[],
  parentId: string | undefined,
  byId: Map<string, IndexedRexWorkItem>,
): void {
  for (const raw of items) {
    const item = toRecord(raw);
    if (!item) continue;
    const id = asNonEmptyString(item.id);
    const title = asNonEmptyString(item.title);
    const level = asNonEmptyString(item.level);
    const status = asNonEmptyString(item.status);
    if (!id || !title || !level || !status) continue;
    byId.set(id, {
      id,
      level,
      title,
      status,
      completedAt: asNonEmptyString(item.completedAt),
      parentId,
    });
    const children = Array.isArray(item.children) ? item.children : [];
    if (children.length > 0) {
      indexRexWorkItems(children, id, byId);
    }
  }
}

function isRexWorkFallbackLevel(level: string): level is RexWorkFallbackItemLevel {
  return level === "epic" || level === "feature" || level === "task";
}

function rexWorkLevelRank(level: RexWorkFallbackItemLevel): number {
  if (level === "epic") return 0;
  if (level === "feature") return 1;
  return 2;
}

function loadBranchScopedRexWorkItems(ctx: ServerContext): RexWorkFallbackItem[] {
  const branch = resolveCurrentBranch(ctx);
  if (!branch) return [];
  const prdPath = join(ctx.rexDir, "prd.json");
  if (!existsSync(prdPath)) return [];

  const touchedIds = collectBranchScopedRexTaskIds(ctx, branch);
  if (touchedIds.size === 0) return [];

  let prdRaw: unknown;
  try {
    prdRaw = JSON.parse(readFileSync(prdPath, "utf-8"));
  } catch {
    return [];
  }

  const prd = toRecord(prdRaw);
  const items = Array.isArray(prd?.items) ? prd.items : [];
  if (items.length === 0) return [];

  const byId = new Map<string, IndexedRexWorkItem>();
  indexRexWorkItems(items, undefined, byId);

  const relevantIds = new Set<string>();
  for (const touchedId of touchedIds) {
    let current = byId.get(touchedId);
    while (current) {
      if (current.status !== "deleted" && isRexWorkFallbackLevel(current.level)) {
        relevantIds.add(current.id);
      }
      if (!current.parentId) break;
      current = byId.get(current.parentId);
    }
  }

  return [...relevantIds]
    .map((id) => byId.get(id))
    .filter((item): item is IndexedRexWorkItem => Boolean(item))
    .filter((item) => item.status !== "deleted" && isRexWorkFallbackLevel(item.level))
    .map((item) => ({
      id: item.id,
      level: item.level as RexWorkFallbackItemLevel,
      title: item.title,
      status: item.status,
      completedAt: item.completedAt,
    }))
    .sort((left, right) => {
      const levelCmp = rexWorkLevelRank(left.level) - rexWorkLevelRank(right.level);
      if (levelCmp !== 0) return levelCmp;
      const titleCmp = left.title.localeCompare(right.title);
      if (titleCmp !== 0) return titleCmp;
      return left.id.localeCompare(right.id);
    });
}

function sortHenchRunsByStartTimeDesc(left: HenchRunFallbackArtifact, right: HenchRunFallbackArtifact): number {
  const leftTs = left.startedAt ? Date.parse(left.startedAt) : NaN;
  const rightTs = right.startedAt ? Date.parse(right.startedAt) : NaN;
  const leftValid = Number.isFinite(leftTs);
  const rightValid = Number.isFinite(rightTs);

  if (leftValid && rightValid) return rightTs - leftTs;
  if (leftValid) return -1;
  if (rightValid) return 1;
  return right.id.localeCompare(left.id);
}

function loadRecentHenchRunArtifacts(ctx: ServerContext, limit: number = 5): HenchRunFallbackArtifact[] {
  const runsDir = join(ctx.projectDir, ".hench", "runs");
  if (!existsSync(runsDir)) return [];
  const activeBranch = resolveCurrentBranch(ctx);
  const branchScopedRexTaskIds = activeBranch ? collectBranchScopedRexTaskIds(ctx, activeBranch) : new Set<string>();

  let files: string[];
  try {
    files = readdirSync(runsDir);
  } catch {
    return [];
  }

  const parsedRuns: HenchRunFallbackArtifact[] = [];
  for (const fileName of files) {
    if (!fileName.endsWith(".json")) continue;
    const runPath = join(runsDir, fileName);
    const fallbackId = asNonEmptyString(fileName.replace(/\.json$/, ""));
    try {
      const raw = readFileSync(runPath, "utf-8");
      const parsed = parseHenchRunArtifact(JSON.parse(raw), fallbackId);
      if (!parsed) continue;
      if (branchScopedRexTaskIds.size > 0) {
        if (!parsed.taskId || !branchScopedRexTaskIds.has(parsed.taskId)) continue;
      }
      parsedRuns.push(parsed);
    } catch {
      // Ignore malformed/missing run artifacts and keep rendering deterministic.
    }
  }

  return parsedRuns
    .sort(sortHenchRunsByStartTimeDesc)
    .slice(0, limit);
}

function buildPRMarkdownArtifactFallbackInput(ctx: ServerContext): PRMarkdownArtifactFallbackInput {
  const manifest = loadDataFile(ctx, DATA_FILES.manifest) as Record<string, unknown> | null;
  const inventory = loadDataFile(ctx, DATA_FILES.inventory) as Record<string, unknown> | null;
  const zones = loadDataFile(ctx, DATA_FILES.zones) as Record<string, unknown> | null;
  const components = loadDataFile(ctx, DATA_FILES.components) as Record<string, unknown> | null;
  const callGraph = loadDataFile(ctx, DATA_FILES.callGraph) as Record<string, unknown> | null;

  const project = typeof manifest?.project === "string" && manifest.project.trim().length > 0
    ? manifest.project
    : basename(ctx.projectDir);
  const totalFiles =
    toFiniteNumber((inventory?.summary as Record<string, unknown> | undefined)?.totalFiles)
    ?? (Array.isArray(inventory?.files) ? inventory.files.length : 0);
  const totalZones = Array.isArray(zones?.zones) ? zones.zones.length : 0;
  const totalComponents = Array.isArray(components?.components) ? components.components.length : 0;
  const hasCallGraph = Array.isArray(callGraph?.edges) || Array.isArray(callGraph?.nodes);
  const rexWorkItems = loadBranchScopedRexWorkItems(ctx);
  const henchRuns = loadRecentHenchRunArtifacts(ctx);
  const hasRexEvidence = rexWorkItems.length > 0;
  const metrics = computePRMarkdownArtifactFallbackMetrics({
    manifest: manifest !== null,
    inventory: inventory !== null,
    zones: zones !== null,
    components: components !== null,
    callgraph: callGraph !== null,
    rex: hasRexEvidence,
    hench: henchRuns.length > 0,
  });

  return {
    project,
    totalFiles,
    totalZones,
    totalComponents,
    hasCallGraph,
    hasRexEvidence,
    rexWorkItems,
    henchRuns,
    metrics,
  };
}

function renderHenchRunArtifactLine(run: HenchRunFallbackArtifact): string {
  const associations: string[] = [];
  if (run.taskId) associations.push(`task \`${run.taskId}\``);
  if (run.taskTitle) associations.push(`"${run.taskTitle}"`);
  const associationText = associations.length > 0 ? ` (${associations.join(", ")})` : "";
  const outcomeText = run.outcome ? `, outcome: ${run.outcome}` : "";
  const timeParts: string[] = [];
  if (run.startedAt) timeParts.push(`started ${run.startedAt}`);
  if (run.finishedAt) timeParts.push(`finished ${run.finishedAt}`);
  const timelineText = timeParts.length > 0 ? `, ${timeParts.join("; ")}` : "";
  return `- Run \`${run.id}\`${associationText}${outcomeText}${timelineText}.`;
}

function renderRexWorkArtifactLine(item: RexWorkFallbackItem): string {
  const statusText = `status: ${item.status}`;
  const completionText = item.completedAt ? `, completedAt: ${item.completedAt}` : "";
  return `- ${item.level.toUpperCase()} \`${item.id}\` "${item.title}" (${statusText}${completionText}).`;
}

function classifyHenchOutcome(outcome: string | null): "success" | "failure" | "unknown" {
  const normalized = outcome?.trim().toLowerCase() ?? "";
  if (!normalized) return "unknown";
  if (normalized === "completed" || normalized === "success" || normalized === "succeeded") return "success";
  if (normalized === "failed" || normalized === "failing" || normalized === "error" || normalized === "budget_exceeded") return "failure";
  return "unknown";
}

function buildTaskExecutionEvidenceBadges(henchRuns: readonly HenchRunFallbackArtifact[]): Map<string, string> {
  const badges = new Map<string, string>();
  for (const run of henchRuns) {
    if (!run.taskId || badges.has(run.taskId)) continue;
    const classified = classifyHenchOutcome(run.outcome);
    const label = classified === "success"
      ? "success"
      : classified === "failure"
        ? "failure"
        : run.outcome?.trim().toLowerCase() || "unknown";
    const timestamp = run.finishedAt ?? run.startedAt;
    const timestampText = timestamp ? ` @ ${timestamp}` : "";
    badges.set(run.taskId, `[run: ${label}${timestampText}]`);
  }
  return badges;
}

function renderRexTaskArtifactLine(item: RexWorkFallbackItem, evidenceBadges: ReadonlyMap<string, string>): string {
  const baseLine = renderRexWorkArtifactLine(item);
  if (item.level !== "task") return baseLine;
  const badge = evidenceBadges.get(item.id) ?? "[run: no run evidence]";
  return `${baseLine} ${badge}`;
}

function renderFallbackEvidenceSourcesUsed(model: PRMarkdownArtifactFallbackInput): string {
  const sources = ["SourceVision artifacts"];
  if (model.hasRexEvidence) sources.push("Rex");
  if (model.henchRuns.length > 0) sources.push("Hench");
  return sources.join(", ");
}

function renderPRMarkdownArtifactFallback(model: PRMarkdownArtifactFallbackInput): string {
  const lines: string[] = [];
  const taskEvidenceBadges = buildTaskExecutionEvidenceBadges(model.henchRuns);
  lines.push("## PR Overview");
  lines.push("");
  lines.push("- Mode: **FALLBACK** (artifact-based; git diff unavailable).");
  lines.push("- Generated in artifact fallback mode because git-based refresh failed.");
  lines.push(`- Evidence sources used: ${renderFallbackEvidenceSourcesUsed(model)}.`);
  lines.push(`- Project: \`${model.project}\``);
  lines.push(`- Analysis inventory: ${model.totalFiles} file(s).`);
  lines.push(`- Architectural zones: ${model.totalZones}.`);
  lines.push(`- Components cataloged: ${model.totalComponents}.`);
  lines.push(`- Call graph available: ${model.hasCallGraph ? "yes" : "no"}.`);
  lines.push(`- Rex evidence available: ${model.hasRexEvidence ? "yes" : "no"}.`);
  if (model.rexWorkItems.length > 0) {
    lines.push(`- Branch-scoped Rex items observed: ${model.rexWorkItems.length}.`);
  }
  if (model.henchRuns.length > 0) {
    lines.push(`- Recent Hench runs observed: ${model.henchRuns.length}.`);
  }
  lines.push(`- Evidence coverage: ${model.metrics.coveragePercent}% (${model.metrics.foundSources.length}/${FALLBACK_EVIDENCE_SOURCES.length} expected sources).`);
  lines.push(`- Fallback confidence: ${model.metrics.confidenceScore}/100.`);
  lines.push("");
  lines.push("## Fallback Evidence Metrics");
  lines.push("");
  lines.push(`- Found evidence sources: ${model.metrics.foundSources.length > 0 ? model.metrics.foundSources.join(", ") : "none"}.`);
  lines.push(`- Missing evidence sources: ${model.metrics.missingSources.length > 0 ? model.metrics.missingSources.join(", ") : "none"}.`);
  lines.push(`- Missing required inputs: ${model.metrics.requiredMissingSources.length > 0 ? model.metrics.requiredMissingSources.join(", ") : "none"}.`);
  lines.push("");
  lines.push("## Important Changes");
  lines.push("");
  lines.push("- Git preflight/fetch/diff data was unavailable during refresh.");
  lines.push("- This summary was generated from existing SourceVision artifacts.");
  if (model.rexWorkItems.length > 0) {
    lines.push("");
    lines.push("## Rex Branch Work Context");
    lines.push("");
    for (const item of model.rexWorkItems) {
      lines.push(renderRexTaskArtifactLine(item, taskEvidenceBadges));
    }
  }
  if (model.henchRuns.length > 0) {
    lines.push("");
    lines.push("## Hench Execution Context");
    lines.push("");
    for (const run of model.henchRuns) {
      lines.push(renderHenchRunArtifactLine(run));
    }
  }
  lines.push("");
  lines.push("## Modified But Unstaged Files");
  lines.push("");
  lines.push("- Unknown in fallback mode.");
  lines.push("");
  lines.push("## Untracked Files");
  lines.push("");
  lines.push("- Unknown in fallback mode.");
  return `${lines.join("\n")}\n`;
}

function getPRMarkdownState(
  ctx: ServerContext,
  snapshot: {
    signature: string | null;
    generatedAt: string | null;
    cacheStatus: PRMarkdownCacheStatus;
    mode: PRMarkdownMode;
    confidence?: number;
    coverage?: number;
  },
): PRMarkdownState {
  const repoCheck = gitOutputResult(ctx, ["rev-parse", "--is-inside-work-tree"]);
  if (!repoCheck.ok) {
    const availability = repoCheck.reason === "missing-git"
      ? "unsupported"
      : repoCheck.reason === "not-a-repo"
        ? "no-repo"
        : "error";
    const message = repoCheck.reason === "missing-git"
      ? "Git is not available on PATH. Install git and restart SourceVision."
      : repoCheck.reason === "not-a-repo"
        ? "This directory is not a git repository. Open a repository to generate PR markdown."
        : "Git commands failed unexpectedly. Verify repository access and try again.";
    return {
      trackedFilesSignature: null,
      gitStatusSignature: null,
      gitDiffSignature: null,
      signature: availability,
      availability,
      message,
      warning: null,
      baseRange: null,
      cacheStatus: snapshot.cacheStatus,
      generatedAt: snapshot.generatedAt,
      staleAfterMs: PR_MARKDOWN_STALE_MS,
      mode: snapshot.mode,
      ...(snapshot.mode === "fallback" && snapshot.confidence !== undefined ? { confidence: snapshot.confidence } : {}),
      ...(snapshot.mode === "fallback" && snapshot.coverage !== undefined ? { coverage: snapshot.coverage } : {}),
    };
  }
  if (repoCheck.output !== "true") {
    return {
      trackedFilesSignature: null,
      gitStatusSignature: null,
      gitDiffSignature: null,
      signature: "no-repo",
      availability: "no-repo",
      message: "This directory is not a git repository. Open a repository to generate PR markdown.",
      warning: null,
      baseRange: null,
      cacheStatus: snapshot.cacheStatus,
      generatedAt: snapshot.generatedAt,
      staleAfterMs: PR_MARKDOWN_STALE_MS,
      mode: snapshot.mode,
      ...(snapshot.mode === "fallback" && snapshot.confidence !== undefined ? { confidence: snapshot.confidence } : {}),
      ...(snapshot.mode === "fallback" && snapshot.coverage !== undefined ? { coverage: snapshot.coverage } : {}),
    };
  }

  const baseRange = getPRComparisonRange(ctx);
  const warning = baseRange
    ? null
    : "Could not resolve base branch (`main` or `origin/main`). Manual PR markdown refresh may be limited.";
  const message = baseRange
    ? null
    : "Repository metadata is available, but manual PR markdown refresh needs a resolvable base branch.";
  const signature = digest(`ready|${snapshot.signature ?? "none"}|${snapshot.cacheStatus}`);

  return {
    trackedFilesSignature: null,
    gitStatusSignature: null,
    gitDiffSignature: null,
    signature,
    availability: "ready",
    message,
    warning,
    baseRange,
    cacheStatus: snapshot.cacheStatus,
    generatedAt: snapshot.generatedAt,
    staleAfterMs: PR_MARKDOWN_STALE_MS,
    mode: snapshot.mode,
    ...(snapshot.mode === "fallback" && snapshot.confidence !== undefined ? { confidence: snapshot.confidence } : {}),
    ...(snapshot.mode === "fallback" && snapshot.coverage !== undefined ? { coverage: snapshot.coverage } : {}),
  };
}

/** Handle sourcevision API requests. Returns true if the request was handled. */
export function handleSourcevisionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const url = req.url || "/";
  const method = req.method || "GET";
  const queryIdx = url.indexOf("?");
  const routePath = queryIdx === -1 ? url : url.slice(0, queryIdx);
  const query = queryIdx === -1 ? "" : url.slice(queryIdx + 1);

  if (!routePath.startsWith(SV_PREFIX)) return false;

  const path = routePath.slice(SV_PREFIX.length);
  const params = new URLSearchParams(query);
  const credentialHelperOptIn = params.get("credentialHelper") === "1"
    || params.get("credentialHelper") === "true";

  // POST /api/sv/pr-markdown/refresh
  if (path === "pr-markdown/refresh" && method === "POST") {
    const preRefreshSnapshot = getPRMarkdownFileSnapshot(ctx);
    try {
      runPRMarkdownRefresh(ctx, { credentialHelperOptIn });
      const refreshedSnapshot = getPRMarkdownFileSnapshot(ctx);
      if (typeof refreshedSnapshot.markdown === "string" && refreshedSnapshot.markdown.trim().length > 0) {
        writePRMarkdownArtifactPayload(ctx, {
          markdown: refreshedSnapshot.markdown,
          mode: "normal",
        });
      } else {
        clearPRMarkdownArtifactPayload(ctx);
      }
      const snapshot = getPRMarkdownFileSnapshot(ctx);
      const state = getPRMarkdownState(ctx, snapshot);
      jsonResponse(res, 200, { ok: true, status: "ok", markdown: snapshot.markdown, ...state });
    } catch (error) {
      const processError = formatProcessErrorContext(error, "unknown error");
      const details = processError.details;
      const code = classifyPRMarkdownRefreshFailureCode(error) ?? classifyPRMarkdownRefreshFailureCode(details);
      const semanticDiffInspectionFailure = isSemanticDiffInspectionFailure(details, code);
      if (semanticDiffInspectionFailure) {
        restorePRMarkdownSnapshot(ctx, preRefreshSnapshot);
      }
      const hasCachedMarkdown = typeof preRefreshSnapshot.markdown === "string" && preRefreshSnapshot.markdown.trim().length > 0;
      const resolvedPreflightContract = code
        ? resolvePRMarkdownRefreshPreflightErrorContract(details, code)
        : null;
      const preflightContract = resolvedPreflightContract && validatePRMarkdownRefreshPreflightErrorContract(resolvedPreflightContract)
        ? resolvedPreflightContract
        : null;
      const diagnostics = code
        ? [{
            code: preflightContract?.code ?? code,
            summary: preflightContract?.summary,
            remediationCommands: preflightContract?.remediationCommands,
            message: preflightContract ? undefined : details,
            hints: getPRMarkdownRefreshRemediationHints(code),
            guidance: resolvePRMarkdownRefreshGuidance(code),
          }]
        : undefined;
      const failure = code
        ? (() => {
            const baseFailure = buildPRMarkdownRefreshFailure(code, details, {
              semanticDiffInspection: semanticDiffInspectionFailure,
              nameStatusDiffSucceeded: semanticDiffInspectionFailure,
              commandExecution: {
                stderr: processError.stderr ?? details,
                exitCode: processError.exitCode,
              },
            });
            if (!preflightContract) return baseFailure;
            return {
              ...baseFailure,
              code: preflightContract.code,
              stage: "preflight" as const,
              summary: preflightContract.summary,
              remediationCommands: preflightContract.remediationCommands,
            };
          })()
        : undefined;
      if (code && shouldUsePRMarkdownFallbackForCode(code)) {
        const fallbackModel = buildPRMarkdownArtifactFallbackInput(ctx);
        const fallbackMetadata = {
          mode: "fallback" as const,
          confidence: fallbackModel.metrics.confidenceScore,
          coverage: fallbackModel.metrics.coveragePercent,
        };
        const fallbackMarkdown = hasCachedMarkdown
          ? preRefreshSnapshot.markdown
          : renderPRMarkdownArtifactFallback(fallbackModel);
        if (typeof fallbackMarkdown === "string" && fallbackMarkdown.trim().length > 0) {
          writePRMarkdownArtifactPayload(ctx, {
            markdown: fallbackMarkdown,
            mode: "fallback",
            confidence: fallbackMetadata.confidence,
            coverage: fallbackMetadata.coverage,
          });
          if (!hasCachedMarkdown) {
            try {
              writeFileSync(join(ctx.svDir, "pr-markdown.md"), fallbackMarkdown, "utf-8");
            } catch {
              // Best-effort fallback artifact caching.
            }
          }
        }
        const state = getPRMarkdownState(ctx, getPRMarkdownFileSnapshot(ctx));
        jsonResponse(res, 200, {
          ok: false,
          status: "degraded",
          markdown: fallbackMarkdown,
          diagnostics,
          failure,
          ...state,
          ...fallbackMetadata,
        });
      } else if (code) {
        jsonResponse(res, 500, {
          error: `Failed to regenerate PR markdown: ${details}`,
          diagnostics,
          failure,
        });
      } else {
        errorResponse(res, 500, `Failed to regenerate PR markdown: ${details}`);
      }
    }
    return true;
  }

  if (method !== "GET") return false;

  // GET /api/sv/manifest
  if (path === "manifest") {
    const data = loadDataFile(ctx, DATA_FILES.manifest);
    if (!data) {
      errorResponse(res, 404, "No manifest data. Run 'sourcevision analyze' first.");
      return true;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/inventory
  if (path === "inventory") {
    const data = loadDataFile(ctx, DATA_FILES.inventory);
    if (!data) {
      errorResponse(res, 404, "No inventory data. Run 'sourcevision analyze' first.");
      return true;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/imports
  if (path === "imports") {
    const data = loadDataFile(ctx, DATA_FILES.imports);
    if (!data) {
      errorResponse(res, 404, "No imports data. Run 'sourcevision analyze' first.");
      return true;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/zones
  if (path === "zones") {
    const data = loadDataFile(ctx, DATA_FILES.zones);
    if (!data) {
      errorResponse(res, 404, "No zones data. Run 'sourcevision analyze' first.");
      return true;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/components
  if (path === "components") {
    const data = loadDataFile(ctx, DATA_FILES.components);
    if (!data) {
      errorResponse(res, 404, "No components data. Run 'sourcevision analyze' first.");
      return true;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/callgraph
  if (path === "callgraph") {
    const data = loadDataFile(ctx, DATA_FILES.callGraph);
    if (!data) {
      errorResponse(res, 404, "No call graph data. Run 'sourcevision analyze' first.");
      return true;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/context
  if (path === "context") {
    const text = loadTextFile(ctx, "CONTEXT.md");
    if (!text) {
      errorResponse(res, 404, "No CONTEXT.md. Run 'sourcevision analyze' first.");
      return true;
    }
    res.writeHead(200, { "Content-Type": "text/markdown", "Cache-Control": "no-cache" });
    res.end(text);
    return true;
  }

  // GET /api/sv/pr-markdown
  if (path === "pr-markdown") {
    const snapshot = getPRMarkdownFileSnapshot(ctx);
    const state = getPRMarkdownState(ctx, snapshot);
    const markdown = snapshot.markdown;
    jsonResponse(res, 200, { markdown, ...state });
    return true;
  }

  // GET /api/sv/pr-markdown/state
  if (path === "pr-markdown/state") {
    const snapshot = getPRMarkdownFileSnapshot(ctx);
    jsonResponse(res, 200, getPRMarkdownState(ctx, snapshot));
    return true;
  }

  // GET /api/sv/summary — aggregate stats
  if (path === "summary") {
    const manifest = loadDataFile(ctx, DATA_FILES.manifest) as Record<string, unknown> | null;
    const inventory = loadDataFile(ctx, DATA_FILES.inventory) as Record<string, unknown> | null;
    const zones = loadDataFile(ctx, DATA_FILES.zones) as Record<string, unknown> | null;
    const components = loadDataFile(ctx, DATA_FILES.components) as Record<string, unknown> | null;
    const callGraph = loadDataFile(ctx, DATA_FILES.callGraph) as Record<string, unknown> | null;

    const summary: Record<string, unknown> = {
      hasManifest: !!manifest,
      hasInventory: !!inventory,
      hasZones: !!zones,
      hasComponents: !!components,
      hasCallGraph: !!callGraph,
    };

    if (manifest) {
      summary.project = (manifest as Record<string, unknown>).project;
      summary.analyzedAt = (manifest as Record<string, unknown>).timestamp;
    }

    if (inventory) {
      const inv = inventory as Record<string, unknown>;
      summary.fileCount = Array.isArray(inv.files) ? inv.files.length : 0;
      summary.inventorySummary = inv.summary;
    }

    if (zones) {
      const z = zones as Record<string, unknown>;
      summary.zoneCount = Array.isArray(z.zones) ? z.zones.length : 0;
    }

    if (components) {
      const c = components as Record<string, unknown>;
      summary.componentCount = Array.isArray(c.components) ? c.components.length : 0;
    }

    if (callGraph) {
      const cg = callGraph as Record<string, unknown>;
      summary.callGraphSummary = cg.summary;
    }

    jsonResponse(res, 200, summary);
    return true;
  }

  return false;
}
