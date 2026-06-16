import { join } from "node:path";
import { createInterface } from "node:readline";
import { readFileSync, existsSync } from "node:fs";
import { resolveStore, findNextTask, findActionableTasks as findActionable, findItem, collectCompletedIds, isRootLevel, isWorkItem, SCHEMA_VERSION, SELF_HEAL_TAG } from "../../prd/rex-gateway.js";
import type { PRDItem, PRDStore } from "../../prd/rex-gateway.js";
import type { PermissionMode, RunRecord, ToolCallRecord } from "../../schema/index.js";
import { PERMISSION_MODES, isPermissionMode } from "../../schema/index.js";
import { classifyChangedFiles } from "../../store/file-classifier.js";
import type { FileCategory } from "../../store/file-classifier.js";
import { loadConfig } from "../../store/config.js";
import { listRuns } from "../../store/runs.js";
import { agentLoop } from "../../agent/lifecycle/loop.js";
import { cliLoop } from "../../agent/lifecycle/cli-loop.js";
import { getActionableTasks, collectEpicTaskIds } from "../../agent/planning/brief.js";
import { getStuckTaskIds } from "../../agent/analysis/stuck.js";
import { HENCH_DIR, safeParseInt, safeParseNonNegInt } from "./constants.js";
import { ConsecutiveFailureCounter, isFailureStatus } from "./consecutive-failures.js";
import { CLIError, EpicNotFoundError, requireLLMCLI } from "../errors.js";
import { info, result as output, setQuiet } from "../output.js";
import { section } from "../../types/output.js";
import { loadLLMConfig, resolveLLMVendor, resolveVendorCliPath } from "../../store/project-config.js";
import { printVendorModelHeader, detectGoogleAuthMethod, resolveModel, resolveVendorModel, bold, green, red, colorStatus, colorSuccess, colorWarn, colorPink, isColorEnabled, isModelCompatibleWithVendor, E_TIMEOUT, E_MALFORMED_RESPONSE, E_NULL_RESPONSE, E_AUTH_FAILURE, E_NETWORK_ERROR, E_UNKNOWN, formatRetryCountdown, classifyLLMError } from "../../prd/llm-gateway.js";
import { ExecutionQueue } from "../../queue/execution-queue.js";
import { formatQueueStatus } from "../../queue/format.js";
import { resolveSchedulingPriority } from "../../queue/priority-scheduler.js";
import type { TaskPriority } from "../../queue/execution-queue.js";
import { ProcessLimiter } from "../../process/limiter.js";
import { MemoryThrottle } from "../../process/memory-throttle.js";
import { checkQuotaRemaining, formatQuotaLog } from "../../quota/index.js";
import { formatTokenReport } from "../token-logging.js";
import { promptRollbackOnInterrupt } from "../../agent/lifecycle/shared.js";
import { revertChanges } from "../../agent/analysis/review.js";

// ---------------------------------------------------------------------------
// Attempt tracking (per-task within a single run invocation)
// ---------------------------------------------------------------------------

/**
 * Tracks attempt count per task ID within a single run invocation.
 * After 3 attempts of the same task, the task is forced to be excluded
 * from subsequent selection in the same run.
 */
export interface AttemptTracker {
  /** Increment and return the new count for the given task ID. */
  incrementAndGetCount(taskId: string): number;
  /** Get the current count for a task ID (0 if never attempted). */
  getCount(taskId: string): number;
  /** Check if a task has reached the maximum of 3 attempts. */
  hasReachedMaxAttempts(taskId: string): boolean;
}

const MAX_TASK_ATTEMPTS = 3;

/**
 * Create an attempt tracker for a single run invocation.
 * Counter resets between separate `ndx run` invocations.
 */
export function createAttemptTracker(): AttemptTracker {
  const counts = new Map<string, number>();

  return {
    incrementAndGetCount(taskId: string): number {
      const current = counts.get(taskId) ?? 0;
      const newCount = current + 1;
      counts.set(taskId, newCount);
      return newCount;
    },
    getCount(taskId: string): number {
      return counts.get(taskId) ?? 0;
    },
    hasReachedMaxAttempts(taskId: string): boolean {
      return (counts.get(taskId) ?? 0) >= MAX_TASK_ATTEMPTS;
    },
  };
}

// ---------------------------------------------------------------------------
// Schema compatibility
// ---------------------------------------------------------------------------

/**
 * Verify the loaded PRD document uses a schema version compatible with this
 * build of hench. Catches mismatches early (at startup) rather than letting
 * them surface as mysterious runtime failures deep in the agent loop.
 */
async function assertSchemaCompatibility(store: PRDStore): Promise<void> {
  const doc = await store.loadDocument();
  if (doc.schema !== SCHEMA_VERSION) {
    throw new CLIError(
      `PRD schema mismatch: document uses "${doc.schema}" but this version ` +
      `of hench expects "${SCHEMA_VERSION}". Rebuild packages or run ` +
      `"ndx init" to upgrade.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

/**
 * Format an inter-task or inter-epic pause notification.
 * Rendered in yellow (colorWarn) to signal a transient wait state.
 * Exported for testing — verifies semantic color helpers are applied.
 */
export function formatPauseMessage(pauseMs: number, target: "task" | "epic"): string {
  return colorWarn(`Pausing ${pauseMs}ms before next ${target}...`);
}

/**
 * Format a run-loop completion message.
 * Rendered in green (colorSuccess) to confirm a clean exit.
 * Exported for testing — verifies semantic color helpers are applied.
 */
export function formatRunSuccessMessage(text: string): string {
  return colorSuccess(text);
}

/**
 * Format a loop-iteration boundary separator line.
 *
 * Rendered in yellow (colorWarn) to visually distinguish loop-iteration
 * boundaries from the cyan ═══ agent-turn section separators.  Width matches
 * SECTION_WIDTH (60 chars) for visual consistency with the rest of the
 * transcript.
 *
 * Fully suppressed (returns plain text that callers skip via NO_COLOR / !isTTY
 * checks in colorWarn) when color is disabled.
 * Exported for testing — verifies colorWarn is applied and suppression works.
 */
export function formatLoopIterationSeparator(): string {
  return colorWarn("─".repeat(60));
}

/**
 * Returns true when the run status indicates a token-exhaustion or rate-limit
 * condition. These statuses are handled differently from hard failures:
 * the loop waits for token replenishment rather than terminating.
 *
 * Returns false for non-token hard failures (failed, timeout) which should
 * terminate the loop immediately with a clear error notification.
 *
 * Exported for testing.
 */
export function isTokenExhaustionStatus(status: string): boolean {
  return status === "budget_exceeded" || status === "error_transient";
}

/**
 * Returns true when the error text indicates a token-exhaustion (rate-limit or
 * quota-exceeded) failure as classified by the shared LLM error classifier.
 *
 * Reuses classifyLLMError so the detection logic is consistent across Claude,
 * Codex, and Google vendors with no duplicated pattern-matching.
 *
 * Exported for testing.
 */
export function isTokenExhaustionError(
  errorText: string | undefined,
  vendor = "claude",
): boolean {
  if (!errorText) return false;
  const classification = classifyLLMError(
    new Error(errorText),
    vendor as "claude" | "codex" | "google",
  );
  return classification.category === "rate-limit" || classification.category === "budget";
}

/**
 * Returns true when the run status indicates a non-retriable hard failure that
 * should terminate the loop immediately. Non-retriable errors are hard failures
 * that are not expected to resolve on retry: agent failure and turn-limit timeout.
 *
 * Retriable errors (budget_exceeded, error_transient) are explicitly excluded:
 * they are handled by the token-exhaustion path and stuck-task detection.
 *
 * Centralized here and reused across all loop modes (runLoop, runEpicByEpic,
 * runIterations) to ensure consistent classification.
 *
 * Exported for testing.
 */
export function isNonRetriableError(status: string): boolean {
  return status === "failed" || status === "timeout";
}

/**
 * Derive a structured error code key from a run status and optional error text.
 * Maps `timeout` → E_TIMEOUT, then checks common patterns in the error text,
 * falling back to E_UNKNOWN for unrecognised failures.
 *
 * @internal Used by formatNonTokenFailureNotification.
 */
function deriveNonTokenErrorCode(status: string, errorText?: string): string {
  if (status === "timeout") return E_TIMEOUT.key;
  if (errorText) {
    if (/malformed|invalid json|parse error|unexpected token/i.test(errorText)) return E_MALFORMED_RESPONSE.key;
    if (/null.*response|empty.*response/i.test(errorText)) return E_NULL_RESPONSE.key;
    if (/auth|api key|credential/i.test(errorText)) return E_AUTH_FAILURE.key;
    if (/network|ECONNRESET|ECONNREFUSED|socket hang up/i.test(errorText)) return E_NETWORK_ERROR.key;
  }
  return E_UNKNOWN.key;
}

/**
 * Format a user-facing error notification for a non-token run failure.
 *
 * Derives the structured error code from the run status and optional error
 * text, then renders a single-line `[CODE] cause` summary in red. When
 * `changedFileCount` is provided and > 0, the count is appended so the
 * operator knows how much work was left uncommitted in the failed run.
 *
 * Called by runLoop() and runEpicByEpic() when a non-retriable failure
 * terminates the loop.
 *
 * Exported for testing — verifies error code derivation and message format.
 */
export function formatNonTokenFailureNotification(
  status: string,
  errorText?: string,
  changedFileCount?: number,
): string {
  const code = deriveNonTokenErrorCode(status, errorText);
  const cause = errorText
    ? errorText.slice(0, 120).replace(/\n/g, " ").trimEnd()
    : `run ${status}`;
  const filesSuffix = changedFileCount != null && changedFileCount > 0
    ? ` · ${changedFileCount} file${changedFileCount === 1 ? "" : "s"} changed`
    : "";
  return red(`Run failed: [${code}] ${cause}${filesSuffix}`);
}

/**
 * Format the iteration boundary banner emitted between loop iterations.
 *
 * - Fixed mode (--iterations=N): `=== Iteration n/total ===`
 * - Unbounded mode (--loop):     `=== Iteration n ===`
 *
 * Uses bold() so it stands out against surrounding transcript lines and
 * respects NO_COLOR (bold() degrades to plain text when color is disabled).
 * Exported for testing.
 */
export function formatIterationBanner(n: number, total?: number): string {
  const label = total !== undefined ? `${n}/${total}` : `${n}`;
  return bold(`=== Iteration ${label} ===`);
}

/**
 * Format a "no actionable tasks" advisory block for epic scope mode.
 * All three lines are rendered in yellow (colorWarn) to signal an advisory
 * state without alarming the user.
 * Exported for testing — verifies semantic color helpers are applied.
 */
export function formatNoActionableTasksWarning(epicTitle: string, blockedCount: number): [string, string, string] {
  return [
    colorWarn(`\n⚠ Epic "${epicTitle}" has no actionable tasks.`),
    colorWarn(`  ${blockedCount} task(s) are blocked or deferred.`),
    colorWarn(`  Use 'rex status' to see task statuses, or update tasks with 'rex update <id> --status=pending'.`),
  ];
}

// ---------------------------------------------------------------------------
// Epic resolution helpers (exported for testing)
// ---------------------------------------------------------------------------

export interface ResolvedEpic {
  id: string;
  title: string;
}

/**
 * List all epics in the PRD (root-level container items).
 */
export function listEpics(items: PRDItem[]): ResolvedEpic[] {
  const epics: ResolvedEpic[] = [];
  for (const item of items) {
    if (isRootLevel(item.level)) {
      epics.push({ id: item.id, title: item.title });
    }
  }
  return epics;
}

/**
 * Find an epic by ID or title (case-insensitive title match).
 * Returns the matched epic or null if not found.
 */
export function findEpicByIdOrTitle(
  items: PRDItem[],
  search: string,
): ResolvedEpic | null {
  const searchLower = search.toLowerCase();
  for (const item of items) {
    if (isRootLevel(item.level)) {
      if (item.id === search || item.title.toLowerCase() === searchLower) {
        return { id: item.id, title: item.title };
      }
    }
  }
  return null;
}

/**
 * Validate and resolve the --epic flag value.
 * Throws EpicNotFoundError with available epics if not found.
 */
export async function resolveEpicFlag(
  store: PRDStore,
  epicFlag: string,
): Promise<ResolvedEpic> {
  const doc = await store.loadDocument();
  const epic = findEpicByIdOrTitle(doc.items, epicFlag);
  if (!epic) {
    const available = listEpics(doc.items);
    throw new EpicNotFoundError(epicFlag, available);
  }
  return epic;
}

// Re-export collectEpicTaskIds from brief.ts for backward compatibility with tests
export { collectEpicTaskIds } from "../../agent/planning/brief.js";

// ---------------------------------------------------------------------------
// Epic scope info
// ---------------------------------------------------------------------------

export interface EpicScopeInfo {
  id: string;
  title: string;
  /** Total number of tasks/subtasks in the epic. */
  totalTasks: number;
  /** Number of completed tasks/subtasks. */
  completedTasks: number;
  /** Number of actionable tasks (pending or in_progress). */
  actionableTasks: number;
  /** True if all tasks are completed (or epic has no tasks). */
  isComplete: boolean;
  /** True if there are actionable tasks to work on. */
  hasActionableTasks: boolean;
}

/**
 * Get detailed scope information about an epic.
 * Counts tasks/subtasks and their completion status.
 */
export async function getEpicScopeInfo(
  store: PRDStore,
  epicId: string,
): Promise<EpicScopeInfo> {
  const doc = await store.loadDocument();
  const epic = findEpicByIdOrTitle(doc.items, epicId);
  if (!epic) {
    throw new EpicNotFoundError(epicId, listEpics(doc.items));
  }
  const resolvedEpicId = epic.id;

  // Walk the tree and count tasks belonging to this epic
  const { walkTree } = await import("../../prd/rex-gateway.js");

  let totalTasks = 0;
  let completedTasks = 0;
  let actionableTasks = 0;

  for (const { item, parents } of walkTree(doc.items)) {
    // Check if this item is inside the target epic
    const isInEpic =
      item.id === resolvedEpicId ||
      parents.some((p) => p.id === resolvedEpicId);

    if (isInEpic && isWorkItem(item.level)) {
      // Deleted items are excluded from all counts
      if (item.status === "deleted") continue;
      totalTasks++;
      if (item.status === "completed") {
        completedTasks++;
      } else if (item.status === "pending" || item.status === "in_progress") {
        actionableTasks++;
      }
      // deferred and blocked are neither completed nor actionable
    }
  }

  const isComplete = totalTasks === 0 || completedTasks === totalTasks;
  const hasActionableTasks = actionableTasks > 0;

  return {
    id: epic.id,
    title: epic.title,
    totalTasks,
    completedTasks,
    actionableTasks,
    isComplete,
    hasActionableTasks,
  };
}

// ---------------------------------------------------------------------------
// Loop helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Determine whether the loop should continue after a task run.
 * Continues on success and transient errors; stops on hard failures
 * only when stuck detection is disabled (threshold 0).
 *
 * With stuck detection enabled, the loop always continues — stuck tasks
 * are simply skipped on the next iteration.
 */
export function shouldContinueLoop(status: string): boolean {
  return status !== "failed" && status !== "timeout" && status !== "budget_exceeded";
}

/**
 * Pause between loop iterations. Respects an optional AbortSignal so
 * that a Ctrl-C handler can interrupt the wait immediately.
 */
export function loopPause(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      if (signal.aborted) {
        clearTimeout(timer);
        resolve();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

// ---------------------------------------------------------------------------
// Token-exhaustion wait countdown
// ---------------------------------------------------------------------------

/**
 * Countdown interval in milliseconds — update the user every 5 s so long
 * waits are not silent.
 */
const COUNTDOWN_UPDATE_INTERVAL_MS = 5_000;

/**
 * Wait until `refreshAt + 1000 ms` with periodic countdown messages.
 *
 * Emits an initial "waiting Xs" message then updates every
 * COUNTDOWN_UPDATE_INTERVAL_MS until the wait completes or the signal fires.
 * When the AbortSignal fires, the wait ends immediately (Ctrl-C path).
 *
 * Returns `true` when the full wait completed, `false` when interrupted.
 *
 * Exported for testing.
 */
export async function waitForTokenRefresh(
  refreshAt: Date,
  signal?: AbortSignal,
): Promise<boolean> {
  // Add 1 s buffer as required by the spec
  const targetMs = refreshAt.getTime() + 1_000;
  const remainingMs = targetMs - Date.now();

  if (remainingMs <= 0) return true;

  const totalSeconds = Math.ceil(remainingMs / 1_000);
  info(colorWarn(`\nToken quota exhausted — waiting ${formatRetryCountdown(totalSeconds)} for quota reset before retrying…`));

  let elapsed = 0;
  while (elapsed < remainingMs) {
    if (signal?.aborted) return false;

    const step = Math.min(COUNTDOWN_UPDATE_INTERVAL_MS, remainingMs - elapsed);
    await loopPause(step, signal);

    if (signal?.aborted) return false;

    elapsed += step;
    const secondsLeft = Math.ceil((remainingMs - elapsed) / 1_000);
    if (secondsLeft > 0) {
      info(colorWarn(`  … ${formatRetryCountdown(secondsLeft)} remaining`));
    }
  }

  return true;
}

/**
 * Format the outcome notification for a token-exhaustion single retry.
 *
 * - On success: green "✓ Token-refresh retry succeeded — run loop exiting cleanly."
 * - On failure: red "✗ Token-refresh retry failed: <cause> — run loop exiting."
 *
 * Exported for testing.
 */
export function formatTokenRefreshRetryOutcome(
  status: string,
  errorText?: string,
): string {
  if (status === "completed") {
    return green("✓ Token-refresh retry succeeded — run loop exiting cleanly.");
  }
  const cause = errorText
    ? errorText.slice(0, 120).replace(/\n/g, " ").trimEnd()
    : `run ${status}`;
  return red(`✗ Token-refresh retry failed: ${cause} — run loop exiting.`);
}

// ---------------------------------------------------------------------------
// Quota log helper (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Fetch remaining quota and emit ANSI-colored log lines at the inter-run
 * boundary.
 *
 * - If `checkQuotaRemaining()` returns data, each entry is formatted and
 *   emitted via `info()`, which suppresses output in quiet/JSON mode.
 * - If the fetch throws, a single degraded indicator is emitted instead
 *   of crashing the loop.
 * - An empty result (no quota data available) produces no output.
 */
export async function emitQuotaLog(): Promise<void> {
  let quotas: Awaited<ReturnType<typeof checkQuotaRemaining>>;
  try {
    quotas = await checkQuotaRemaining();
  } catch {
    info("quota: unavailable");
    return;
  }
  for (const line of formatQuotaLog(quotas)) {
    info(line);
  }
}

// ---------------------------------------------------------------------------
// Stuck task helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Load recent runs and compute which tasks are stuck (≥ threshold
 * consecutive hard failures).  Returns an empty set when threshold
 * is 0 (disabled).
 */
export async function loadStuckTaskIds(
  henchDir: string,
  threshold: number,
): Promise<Set<string>> {
  if (threshold <= 0) return new Set();
  const runs = await listRuns(henchDir);
  const stuck = getStuckTaskIds(runs, threshold);
  if (stuck.size > 0) {
    info(`Stuck tasks detected (${stuck.size}): ${[...stuck].join(", ")}`);
  }
  return stuck;
}

// ---------------------------------------------------------------------------
// Execution queue factory (exported for testing and external consumers)
// ---------------------------------------------------------------------------

/**
 * Create an ExecutionQueue sized from the hench guard config.
 *
 * The queue limits concurrent task executions to
 * `guard.maxConcurrentProcesses` (default 3). This is the same
 * limit used for cross-process concurrency, applied here at the
 * in-process task-run level.
 */
export function createExecutionQueue(maxConcurrent: number): ExecutionQueue {
  return new ExecutionQueue(maxConcurrent);
}

// ---------------------------------------------------------------------------
// Priority resolution helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Peek at the next task's scheduling priority without consuming it.
 *
 * Looks up the task (by explicit ID or auto-selection) and resolves
 * its effective scheduling priority from PRD metadata and optional
 * CLI override. This priority is used for {@link ExecutionQueue}
 * insertion ordering so that high-priority tasks bypass normal queue
 * position under resource constraints.
 *
 * @param store PRD store
 * @param taskId Explicit task ID (from --task flag), or undefined for auto-select
 * @param cliOverride Priority override from --priority flag
 * @param excludeTaskIds Task IDs to skip during auto-selection
 * @param epicId Restrict selection to this epic
 */
export async function peekNextTaskPriority(
  store: PRDStore,
  taskId?: string,
  cliOverride?: string,
  excludeTaskIds?: Set<string>,
  epicId?: string,
  tags?: string[],
): Promise<TaskPriority> {
  const doc = await store.loadDocument();

  // If explicit task ID, look it up directly
  if (taskId) {
    const entry = findItem(doc.items, taskId);
    if (entry) {
      return resolveSchedulingPriority({
        taskPriority: entry.item.priority,
        tags: entry.item.tags,
        cliOverride,
      });
    }
    // Task not found — defer to default; runOne will throw later
    return resolveSchedulingPriority({ cliOverride });
  }

  // Auto-select: peek at what findNextTask would pick
  const completedIds = collectCompletedIds(doc.items);
  const skipIds = excludeTaskIds
    ? new Set([...completedIds, ...excludeTaskIds])
    : completedIds;

  const tagOptions = tags?.length ? { tags } : undefined;

  if (epicId) {
    // Use the same logic as assembleTaskBrief for epic-scoped selection
    const epicTaskIds = collectEpicTaskIds(doc.items, epicId);
    const allActionable = findActionable(doc.items, skipIds, Infinity, tagOptions);
    const epicActionable = allActionable.filter(
      (e) => epicTaskIds.has(e.item.id) && !excludeTaskIds?.has(e.item.id),
    );
    if (epicActionable.length > 0) {
      const next = epicActionable[0];
      return resolveSchedulingPriority({
        taskPriority: next.item.priority,
        tags: next.item.tags,
        cliOverride,
      });
    }
  } else {
    const next = findNextTask(doc.items, skipIds, tagOptions);
    if (next) {
      return resolveSchedulingPriority({
        taskPriority: next.item.priority,
        tags: next.item.tags,
        cliOverride,
      });
    }
  }

  // No actionable tasks — default priority (runOne will handle the error)
  return resolveSchedulingPriority({ cliOverride });
}

/**
 * Log queue status if there are any queued tasks.
 * Suppressed when the queue is idle.
 */
function logQueueStatus(queue: ExecutionQueue): void {
  const lines = formatQueueStatus(queue.status());
  for (const line of lines) {
    info(line);
  }
}

// ---------------------------------------------------------------------------
// Interactive task selection
// ---------------------------------------------------------------------------

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function selectTask(
  dir: string,
  rexDir: string,
  epicId?: string,
): Promise<string> {
  const store = await resolveStore(rexDir);
  let tasks = await getActionableTasks(store);

  // Filter to tasks within the specified epic if provided
  if (epicId) {
    const doc = await store.loadDocument();
    const epicTaskIds = collectEpicTaskIds(doc.items, epicId);
    tasks = tasks.filter((t) => epicTaskIds.has(t.id));
  }

  if (tasks.length === 0) {
    const scope = epicId ? "within the specified epic" : "in PRD";
    output(`No actionable tasks found ${scope}.`);
    process.exit(0);
  }

  info("\nActionable tasks (by priority):\n");
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const pri = `[${t.priority}]`.padEnd(10);
    const chain = t.parentChain ? ` (${t.parentChain})` : "";
    info(`  ${String(i + 1).padStart(2)}. ${pri} ${t.title}${chain}`);
  }
  info("");

  const answer = await promptUser(`Select task [1]: `);
  const idx = answer === "" ? 0 : parseInt(answer, 10) - 1;

  if (isNaN(idx) || idx < 0 || idx >= tasks.length) {
    throw new CLIError(
      "Invalid selection.",
      `Enter a number between 1 and ${tasks.length}.`,
    );
  }

  return tasks[idx].id;
}

// ---------------------------------------------------------------------------
// Change classification
// ---------------------------------------------------------------------------

/**
 * Count the number of non-metadata files changed during a run.
 * Used to include the changed-file count in terminal failure notifications.
 */
function countChangedFiles(toolCalls: ToolCallRecord[]): number {
  const classified = classifyChangedFiles(toolCalls);
  classified.delete("metadata");
  return [...classified.values()].reduce((sum, files) => sum + files.length, 0);
}

/**
 * Detect whether any tool calls include PRD status updates (rex_update).
 */
function hasPrdStatusUpdate(toolCalls: ToolCallRecord[]): boolean {
  return toolCalls.some((c) => c.tool === "rex_update" || c.tool === "rex_add");
}

/**
 * Format a change classification summary for the run output.
 *
 * Examples:
 *   "Changes: 3 files (2 code, 1 test) + PRD status update"
 *   "Changes: PRD status update only (no code changes)"
 *   "Changes: 1 file (1 docs)"
 */
function formatChangeClassification(toolCalls: ToolCallRecord[]): string {
  const classified = classifyChangedFiles(toolCalls);
  const prdUpdate = hasPrdStatusUpdate(toolCalls);

  // Remove metadata from the classified map for display purposes
  // (metadata = prd.json, shown separately as "PRD status update")
  classified.delete("metadata");

  const totalFiles = [...classified.values()].reduce((sum, files) => sum + files.length, 0);

  if (totalFiles === 0 && prdUpdate) {
    return "Changes: PRD status update only (no code changes)";
  }

  if (totalFiles === 0 && !prdUpdate) {
    return "Changes: none";
  }

  // Build category breakdown
  const categoryLabels: string[] = [];
  const ORDER: FileCategory[] = ["code", "test", "docs", "config"];
  for (const cat of ORDER) {
    const files = classified.get(cat);
    if (files && files.length > 0) {
      categoryLabels.push(`${files.length} ${cat}`);
    }
  }

  const fileLabel = totalFiles === 1 ? "file" : "files";
  const breakdown = categoryLabels.join(", ");
  const prdSuffix = prdUpdate ? " + PRD status update" : "";

  return `Changes: ${totalFiles} ${fileLabel} (${breakdown})${prdSuffix}`;
}

// ---------------------------------------------------------------------------
// Single task execution
// ---------------------------------------------------------------------------

async function runOne(
  dir: string,
  henchDir: string,
  rexDir: string,
  provider: "cli" | "api",
  taskId: string | undefined,
  dryRun: boolean,
  model: string | undefined,
  spawnModel: string | undefined,
  maxTurns: number | undefined,
  tokenBudget: number | undefined,
  review: boolean,
  excludeTaskIds?: Set<string>,
  epicId?: string,
  tags?: string[],
  runHistory?: RunRecord[],
  rollbackOnFailure?: boolean,
  yes?: boolean,
  extraContext?: string,
  autonomous?: boolean,
  runNumber?: number,
  permissionMode?: PermissionMode,
): Promise<{ status: string; taskTitle: string; selectedTaskId?: string; error?: string; changedFileCount: number; tokenRefreshAt?: string }> {
  const config = await loadConfig(henchDir);
  const store = await resolveStore(rexDir);
  await assertSchemaCompatibility(store);

  // Load run history for prior attempt display if not provided
  const runs = runHistory ?? await listRuns(henchDir);

  // Apply CLI token budget override to config for CLI provider
  const effectiveConfig = tokenBudget != null
    ? { ...config, provider, tokenBudget }
    : { ...config, provider };

  const result = provider === "cli"
    ? await cliLoop({
        config: effectiveConfig as typeof config & { provider: "cli" },
        store,
        projectDir: dir,
        henchDir,
        taskId,
        dryRun,
        model,
        spawnModel,
        review,
        excludeTaskIds,
        epicId,
        tags,
        runHistory: runs,
        rollbackOnFailure,
        yes,
        autonomous,
        extraContext,
        runNumber,
        permissionMode,
      })
    : await agentLoop({
        config: effectiveConfig as typeof config & { provider: "api" },
        store,
        projectDir: dir,
        henchDir,
        taskId,
        dryRun,
        maxTurns,
        tokenBudget,
        model,
        review,
        excludeTaskIds,
        epicId,
        tags,
        runHistory: runs,
        rollbackOnFailure,
        yes,
        autonomous,
        extraContext,
        runNumber,
      });

  const { run } = result;

  info(`\n${bold("=== Run Complete ===")}`);
  output(`Run ID: ${run.id}`);
  output(`Task: ${colorPink(run.taskTitle)}`);
  output(`Status: ${colorStatus(run.status)}`);

  // Invocation context
  if (run.invocationContext) {
    const label = run.invocationContext === "cli" ? "CLI" : "API";
    output(colorWarn(`Invocation: ${label}`));
  }

  // Duration
  if (run.startedAt && run.finishedAt) {
    const durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    info(`Duration: ${formatDuration(durationMs)}`);
  }

  info(`Turns: ${run.turns}`);
  info(formatTokenReport(run.tokenUsage));
  info(`Tool calls: ${run.toolCalls.length}`);

  // Memory stats
  if (run.memoryStats) {
    const peakMB = Math.round(run.memoryStats.peakRssBytes / 1024 / 1024);
    const availGB = run.memoryStats.systemAvailableAtEndBytes >= 0
      ? (run.memoryStats.systemAvailableAtEndBytes / 1024 / 1024 / 1024).toFixed(1)
      : "?";
    const totalGB = run.memoryStats.systemTotalBytes >= 0
      ? (run.memoryStats.systemTotalBytes / 1024 / 1024 / 1024).toFixed(1)
      : "?";
    info(`Memory: ${peakMB} MB peak RSS (system: ${availGB} / ${totalGB} GB available)`);
  }

  // Post-task test results
  const postTests = run.structuredSummary?.postRunTests;
  if (postTests?.ran) {
    const scope = postTests.targetedFiles.length > 0
      ? `${postTests.targetedFiles.length} targeted file(s)`
      : "full suite";
    const testResult = postTests.passed ? green("passed") : red("FAILED");
    info(`Post-task tests: ${testResult} (${scope}, ${postTests.durationMs ?? 0}ms)`);
  }

  // Change classification
  info(formatChangeClassification(run.toolCalls));

  if (run.summary) {
    info(`\nSummary: ${run.summary}`);
  }
  if (run.error) {
    output(`\n${red("Error:")} ${run.error}`);
  }

  return { status: run.status, taskTitle: run.taskTitle, selectedTaskId: run.taskId, error: run.error, changedFileCount: countChangedFiles(run.toolCalls), tokenRefreshAt: run.tokenRefreshAt };
}

// ---------------------------------------------------------------------------
// No-more-tasks sentinel
// ---------------------------------------------------------------------------

const NO_TASKS_MSG = "No actionable tasks found in PRD";

function isNoTasksError(err: unknown): boolean {
  return err instanceof Error && err.message.includes(NO_TASKS_MSG);
}

// ---------------------------------------------------------------------------
// Tag-filter completion helpers (used by runLoop for self-heal mode)
// ---------------------------------------------------------------------------

/** Returns true if there are still actionable tasks matching the given tags. */
async function hasPendingTaggedTasks(rexDir: string, tags: string[]): Promise<boolean> {
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();
  const completedIds = collectCompletedIds(doc.items);
  const remaining = findActionable(doc.items, completedIds, 1, { tags });
  return remaining.length > 0;
}

interface CompletedItem {
  title: string;
  status: string;
}

/**
 * Build the completion summary lines for a tag-filtered loop run.
 * Returns an array of lines (without leading newlines) so callers can
 * either print them or assert on the content in tests.
 */
export function formatTagFilterCompletionSummary(
  tags: string[],
  items: CompletedItem[],
  processedCount: number,
): string[] {
  const tagLabel = tags.join(", ");
  const lines: string[] = [
    `All [${tagLabel}] tasks complete — ${processedCount} task(s) processed.`,
  ];
  if (items.length > 0) {
    lines.push("Resolved tasks:");
    for (const item of items) {
      const icon = item.status === "completed" ? green("✓") : red("✗");
      lines.push(`  ${icon} ${item.title} (${item.status})`);
    }
  }
  return lines;
}

/** Print the per-task summary emitted when all tagged items are resolved. */
function printTagFilterCompletionSummary(
  tags: string[],
  items: CompletedItem[],
  processedCount: number,
): void {
  const lines = formatTagFilterCompletionSummary(tags, items, processedCount);
  for (const line of lines) {
    info(`\n${line}`);
  }
}

// ---------------------------------------------------------------------------
// cmdRun — main entry point
// ---------------------------------------------------------------------------

export async function cmdRun(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);
  const config = await loadConfig(henchDir);
  const rexDir = join(dir, config.rexDir);
  const llmConfig = await loadLLMConfig(henchDir);
  const llmVendor = resolveLLMVendor(llmConfig);

  // Resolve model: CLI flag > .n-dx.json config > default.
  // CLI flag accepts both the vendor-neutral `--model` and the vendor-specific
  // `--claude-model` / `--codex-model` (the latter pair is also recognized by
  // `ndx init`; supporting them here means `ndx work --claude-model=…` works
  // end-to-end). The top-level `llm.model` field is honored ahead of the
  // vendor-pinned slot inside `resolveVendorModel`.
  const cliModelOverride =
    flags.model
    ?? (llmVendor === "claude"
      ? flags["claude-model"]
      : llmVendor === "codex"
        ? flags["codex-model"]
        : flags["google-model"]);
  const configuredModel = resolveVendorModel(llmVendor, llmConfig);
  const resolvedModel = cliModelOverride ? resolveModel(cliModelOverride) : configuredModel;
  const hasConfiguredModel =
    !!llmConfig?.model
    || (llmVendor === "claude"
      ? !!llmConfig?.claude?.model
      : llmVendor === "codex"
        ? !!llmConfig?.codex?.model
        : !!llmConfig?.google?.model);
  const modelSource: "cli-override" | "configured" | "default" = cliModelOverride
    ? "cli-override"
    : hasConfiguredModel
      ? "configured"
      : "default";

  // Validate vendor-model compatibility: error if the model that actually
  // resolved (either top-level llm.model or vendor-pinned) is incompatible
  // with the active vendor. Picks the same value resolveVendorModel uses.
  const activeConfiguredModel = llmConfig?.model
    ?? (llmVendor === "claude"
      ? llmConfig?.claude?.model
      : llmVendor === "codex"
        ? llmConfig?.codex?.model
        : llmConfig?.google?.model);
  if (!cliModelOverride && activeConfiguredModel) {
    if (
      llmVendor === "claude" &&
      !isModelCompatibleWithVendor("claude", activeConfiguredModel)
    ) {
      throw new CLIError(
        `Configured model "${activeConfiguredModel}" is not compatible with vendor="claude".`,
        `Either use a Claude model (e.g., sonnet, opus) or switch vendor: 'n-dx config llm.vendor codex'`,
      );
    }
    if (
      llmVendor === "codex" &&
      !isModelCompatibleWithVendor("codex", activeConfiguredModel)
    ) {
      throw new CLIError(
        `Configured model "${activeConfiguredModel}" is not compatible with vendor="codex".`,
        `Either use a Codex/GPT model (e.g., gpt-4o, o1) or switch vendor: 'n-dx config llm.vendor claude'`,
      );
    }
    if (
      llmVendor === "google" &&
      !isModelCompatibleWithVendor("google", activeConfiguredModel)
    ) {
      throw new CLIError(
        `Configured model "${activeConfiguredModel}" is not compatible with vendor="google".`,
        `Either use a Gemini model (e.g., gemini-2.5-pro, gemini-2.0-flash) or switch vendor: 'n-dx config llm.vendor claude'`,
      );
    }
  }

  // Surface vendor/model at command start for operator visibility.
  // Reads the most recent run artifact (if any) to detect model changes.
  const recentRuns = await listRuns(henchDir, 1);
  const lastRunModel = recentRuns[0]?.model;
  // For Google vendor, detect active auth method (OAuth vs API key) so the
  // header can show which credential pathway will be used.
  const googleAuthMethod = llmVendor === "google"
    ? await detectGoogleAuthMethod(llmConfig?.google).catch(() => undefined)
    : undefined;
  printVendorModelHeader(llmVendor, llmConfig, {
    lastModel: lastRunModel ? resolveModel(lastRunModel) : undefined,
    resolvedModel,
    modelSource,
    authMethod: googleAuthMethod,
  });

  // Suppress all informational output (including quota lines) in JSON mode,
  // consistent with how --quiet suppresses info() output.
  if (flags.format === "json") setQuiet(true);

  const provider = (flags.provider as "cli" | "api") ?? config.provider;
  const dryRun = flags["dry-run"] === "true";
  const review = flags.review === "true";
  // --no-rollback is deprecated: automatic git rollback on failure has been removed.
  // Failed and cancelled runs now preserve the working tree unchanged.
  // The flag is accepted but has no effect; emit a deprecation notice when used.
  if (flags["no-rollback"] === "true") {
    info("⚠ --no-rollback is deprecated and has no effect. Working tree is always preserved on failure.");
  }
  const rollbackOnFailure = flags["no-rollback"] === "true" ? false : (config.rollbackOnFailure ?? true);
  // --yes suppresses the interactive confirmation prompt before rollback.
  const yes = flags["yes"] === "true";
  const model = resolvedModel;
  // Always pass the resolved model to the spawned vendor CLI so the user's
  // configured choice (top-level or vendor-pinned) survives the spawn. The
  // adapter only appends a model flag when this value is set.
  const spawnModel = resolvedModel;
  const auto = flags.auto === "true";
  const loop = flags.loop === "true";
  const selfHeal = flags["self-heal"] === "true";
  const skipDeps = flags["skip-deps"] === "true";

  // --permission-mode: validate against the four supported Claude CLI modes.
  // Resolution order (flag > config > runtime default) is computed below
  // after `autonomous` is derived, since the autonomous default depends on it.
  const permissionModeFlag = flags["permission-mode"];
  if (permissionModeFlag !== undefined && !isPermissionMode(permissionModeFlag)) {
    throw new CLIError(
      `Invalid --permission-mode value "${permissionModeFlag}".`,
      `Use one of: ${PERMISSION_MODES.join(", ")}.`,
    );
  }
  let tagsFilter = flags["tags"]
    ? (flags["tags"] as string).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  // Apply self-heal mode to config so it flows through to prompt building
  if (selfHeal) {
    config.selfHeal = true;
    // In self-heal mode, automatically restrict to self-heal-items.
    // Tag filter can still be combined with other explicit tags via --tags.
    tagsFilter = tagsFilter ? [...tagsFilter, SELF_HEAL_TAG] : [SELF_HEAL_TAG];
  }

  // Codex only supports CLI mode (no API loop).
  if (llmVendor === "codex" && provider === "api" && !dryRun) {
    throw new CLIError(
      "Hench API provider is only supported for vendor=claude or vendor=google.",
      "Set 'n-dx config hench.provider cli' or switch vendor: 'n-dx config llm.vendor claude'.",
    );
  }

  // Google only supports API mode (no CLI binary exists).
  if (llmVendor === "google" && provider === "cli" && !dryRun) {
    throw new CLIError(
      "Google vendor does not support CLI mode — it uses the Gemini REST API directly.",
      "Set 'n-dx config hench.provider api' or switch vendor: 'n-dx config llm.vendor claude'.",
    );
  }

  // Fail fast if CLI provider selected but vendor CLI binary not available.
  // Google is excluded — it has no CLI binary and is already guarded above.
  if (provider === "cli" && !dryRun && llmVendor !== "google") {
    const customPath = resolveVendorCliPath(llmConfig);
    requireLLMCLI(llmVendor as "claude" | "codex", customPath);
  }

  const iterations = flags.iterations ? safeParseInt(flags.iterations, "iterations") : 1;
  const maxTurns = flags["max-turns"] ? safeParseInt(flags["max-turns"], "max-turns") : undefined;
  const tokenBudget = flags["token-budget"] != null ? safeParseNonNegInt(flags["token-budget"], "token-budget") : undefined;
  const pauseMs = flags["loop-pause"]
    ? safeParseInt(flags["loop-pause"], "loop-pause")
    : config.loopPauseMs;

  // Validate epic flag if provided (validates existence before starting work)
  let epicId: string | undefined;
  if (flags.epic) {
    const store = await resolveStore(rexDir);
    const scopeInfo = await getEpicScopeInfo(store, flags.epic);
    epicId = scopeInfo.id;

    // Show epic scope with completion status
    const progress = scopeInfo.totalTasks > 0
      ? `${scopeInfo.completedTasks}/${scopeInfo.totalTasks} tasks complete`
      : "no tasks";
    info(`Epic scope: ${scopeInfo.title} (${scopeInfo.id}) — ${progress}`);

    // Check for completion or no actionable tasks
    if (scopeInfo.isComplete) {
      output(`\n${formatRunSuccessMessage(`✓ All tasks in epic "${scopeInfo.title}" are complete.`)}`);
      process.exit(0);
    }
    if (!scopeInfo.hasActionableTasks) {
      const [line1, line2, line3] = formatNoActionableTasksWarning(
        scopeInfo.title,
        scopeInfo.totalTasks - scopeInfo.completedTasks,
      );
      output(line1);
      output(line2);
      output(line3);
      process.exit(0);
    }
  }

  const epicByEpic = flags["epic-by-epic"] === "true";

  // --priority flag: override task scheduling priority.
  // Valid values: critical, high, medium, low.
  const priorityOverride = flags.priority;

  // --context-file flag: read extra project context (injected by pair-programming).
  // If the file is absent or unreadable, warn and continue without context.
  let extraContext: string | undefined;
  const contextFilePath = flags["context-file"];
  if (contextFilePath) {
    if (existsSync(contextFilePath)) {
      try {
        extraContext = readFileSync(contextFilePath, "utf-8");
      } catch (err) {
        info(`⚠ Could not read context file "${contextFilePath}": ${(err as Error).message}`);
      }
    } else {
      info(`⚠ Context file not found: "${contextFilePath}" — proceeding without context`);
    }
  }

  // --epic-by-epic and --epic are mutually exclusive
  if (epicByEpic && flags.epic) {
    throw new CLIError(
      "Cannot use --epic-by-epic with --epic.",
      "Use --epic to scope to a single epic, or --epic-by-epic to process all epics sequentially.",
    );
  }

  // Memory-based execution throttling.
  // Delays or rejects runs when system memory is under pressure.
  const throttle = new MemoryThrottle(config.guard.memoryThrottle);
  await throttle.gate(({ decision, memoryUsagePercent, delayMs, attempt, maxRetries }) => {
    if (decision === "delay") {
      info(
        `⏳ Memory usage high (${memoryUsagePercent.toFixed(1)}%) — ` +
        `delaying execution ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`,
      );
    } else if (decision === "reject") {
      info(`🚫 Memory usage critical (${memoryUsagePercent.toFixed(1)}%) — rejecting execution`);
    } else if (attempt > 0) {
      info(`✓ Memory usage recovered (${memoryUsagePercent.toFixed(1)}%) — proceeding`);
    }
  });

  // Enforce cross-process concurrency limit.
  // Prevents multiple `hench run` invocations from exhausting memory.
  const limiter = new ProcessLimiter(henchDir, config.guard.maxConcurrentProcesses);
  await limiter.acquire(flags.task);

  try {
    // Create execution queue for in-process concurrency control.
    // The queue limits concurrent task runs within this process
    // (loop mode, epic-by-epic).
    const queue = createExecutionQueue(config.guard.maxConcurrentProcesses);

    // Run dependency audit in self-heal mode (once per hench invocation, before task loop)
    if (selfHeal && !skipDeps && !dryRun) {
      const { runDependencyAudit } = await import("../../tools/test-runner.js");
      const { writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      info("\n[Dependency Audit]");
      const audit = await runDependencyAudit({
        projectDir: dir,
        timeout: 60_000,
      });

      // Store audit result to a temp file so the first run can include it
      const auditFile = join(henchDir, ".pending-audit.json");
      try {
        writeFileSync(auditFile, JSON.stringify(audit, null, 2));
      } catch {
        // Ignore if we can't write the temp file
      }

      if (audit.ran) {
        const vulnCount =
          audit.vulnerabilities.critical +
          audit.vulnerabilities.high +
          audit.vulnerabilities.moderate +
          audit.vulnerabilities.low;
        const outdatedCount =
          audit.outdated.major.length +
          audit.outdated.minor.length +
          audit.outdated.patch.length;

        if (vulnCount === 0 && outdatedCount === 0) {
          info("✓ No vulnerabilities or outdated packages found");
        } else {
          if (vulnCount > 0) {
            info(
              `Found ${vulnCount} vulnerabilities: ${audit.vulnerabilities.critical} critical, ` +
              `${audit.vulnerabilities.high} high, ${audit.vulnerabilities.moderate} moderate, ` +
              `${audit.vulnerabilities.low} low`,
            );
          }
          if (outdatedCount > 0) {
            info(
              `Found ${outdatedCount} outdated packages: ${audit.outdated.major.length} major, ` +
              `${audit.outdated.minor.length} minor, ${audit.outdated.patch.length} patch`,
            );
          }
        }
        if (audit.totalDurationMs != null) {
          info(`Audit completed in ${Math.round(audit.totalDurationMs / 1000)}s`);
        }
      } else if (audit.skipped && audit.skipReason) {
        info(`Skipped: ${audit.skipReason}`);
      } else if (audit.error) {
        info(`Audit error: ${audit.error}`);
      }
    }

    // Autonomous runs (--auto, --loop, --epic-by-epic) bypass interactive
    // prompts such as the commit-message approval gate. The same flag state
    // governs task autoselect above — both are facets of "running unattended".
    const autonomous = auto || loop || epicByEpic;

    // Resolve the effective permission mode for the spawned Claude session.
    // Precedence: --permission-mode flag > config.permissionMode > autonomous
    // default ("acceptEdits") > undefined (Claude CLI's built-in default).
    // Codex spawns ignore this — warn the user that the value will be dropped.
    let effectivePermissionMode: PermissionMode | undefined =
      (permissionModeFlag as PermissionMode | undefined) ??
      config.permissionMode ??
      (autonomous ? "acceptEdits" : undefined);
    if (effectivePermissionMode && llmVendor !== "claude") {
      info(
        `⚠ --permission-mode is a Claude CLI feature; ignoring "${effectivePermissionMode}" for vendor=${llmVendor}.`,
      );
      effectivePermissionMode = undefined;
    }

    if (epicByEpic) {
      await runEpicByEpic(dir, henchDir, rexDir, provider, dryRun, model, spawnModel, maxTurns, tokenBudget, pauseMs, config.maxFailedAttempts, review, queue, priorityOverride, rollbackOnFailure, yes, extraContext, autonomous, effectivePermissionMode);
      return;
    }

    let taskId = flags.task;

    // Task selection: --task > interactive (TTY) > autoselect
    // In loop mode, always autoselect (skip interactive)
    if (!taskId && !auto && !loop && process.stdin.isTTY && !dryRun) {
      taskId = await selectTask(dir, rexDir, epicId);
    }
    // If --auto, --loop, or non-TTY, taskId stays undefined → assembleTaskBrief autoselects

    if (loop) {
      await runLoop(dir, henchDir, rexDir, provider, taskId, dryRun, model, spawnModel, maxTurns, tokenBudget, pauseMs, config.maxFailedAttempts, review, epicId, tagsFilter, queue, priorityOverride, rollbackOnFailure, yes, extraContext, autonomous, effectivePermissionMode);
    } else {
      await runIterations(dir, henchDir, rexDir, provider, taskId, dryRun, model, spawnModel, maxTurns, tokenBudget, iterations, config.maxFailedAttempts, review, epicId, tagsFilter, rollbackOnFailure, yes, extraContext, autonomous, effectivePermissionMode);
    }
  } finally {
    await limiter.release();
  }
}

// ---------------------------------------------------------------------------
// Fixed iteration mode (existing behaviour)
// ---------------------------------------------------------------------------

async function runIterations(
  dir: string,
  henchDir: string,
  rexDir: string,
  provider: "cli" | "api",
  taskId: string | undefined,
  dryRun: boolean,
  model: string | undefined,
  spawnModel: string | undefined,
  maxTurns: number | undefined,
  tokenBudget: number | undefined,
  iterations: number,
  maxFailedAttempts: number,
  review: boolean,
  epicId?: string,
  tags?: string[],
  rollbackOnFailure?: boolean,
  yes?: boolean,
  extraContext?: string,
  autonomous?: boolean,
  permissionMode?: PermissionMode,
): Promise<void> {
  // SIGINT handler: show rollback Y/n prompt on first Ctrl+C.
  // The inner agentLoop also registers its own handler (which sets cancelled=true),
  // but that runs after this one. promptRollbackOnInterrupt suspends all listeners
  // (including the inner one) while the prompt is open.
  //
  // During a token-replenishment wait there is nothing to roll back — the run
  // terminated cleanly due to quota exhaustion. The abort controller lets the
  // SIGINT handler unblock waitForTokenRefresh without showing the prompt.
  const ac = new AbortController();
  let sigintFired = false;
  // True while waitForTokenRefresh is active; used to suppress the rollback
  // prompt if Ctrl+C fires during the wait.
  let isInTokenWait = false;

  const onSignal = () => {
    if (sigintFired) {
      process.exit(1);
    }
    sigintFired = true;
    ac.abort(); // interrupt any active token-refresh wait
    // During a token-replenishment wait there is nothing to roll back —
    // the run terminated cleanly due to quota, so skip the rollback prompt.
    if (isInTokenWait) {
      process.exit(1);
      return;
    }
    void promptRollbackOnInterrupt().then(async (doRollback) => {
      if (doRollback) {
        try { await revertChanges(dir); } catch { /* best-effort */ }
        process.exit(0);
      } else {
        process.exit(1);
      }
    }).catch(() => process.exit(1));
  };
  process.on("SIGINT", onSignal);

  // Track attempt counts per task ID within this run invocation
  const attemptTracker = createAttemptTracker();
  // Tasks excluded from selection due to reaching 3 attempts
  const forcedExclusionIds = new Set<string>();

  try {
    for (let i = 0; i < iterations; i++) {
      // Banner between iterations: printed before iteration i+1 starts,
      // i.e. after iteration i's commit and run summary have been rendered.
      // Not emitted before the first iteration (i === 0).
      if (i > 0) {
        info(`\n${formatIterationBanner(i + 1, iterations)}`);
      }

      // For autoselected iterations, skip stuck tasks
      const isAutoselect = i > 0 || !taskId;
      const stuckIds = isAutoselect
        ? await loadStuckTaskIds(henchDir, maxFailedAttempts)
        : undefined;

      // Combine stuck tasks with tasks that reached max attempts
      const combinedExcludedIds = stuckIds
        ? new Set([...stuckIds, ...forcedExclusionIds])
        : forcedExclusionIds;

      const {
        status,
        selectedTaskId,
        error: runError,
        changedFileCount: runChangedFileCount,
        tokenRefreshAt: runTokenRefreshAt,
      } = await runOne(
        dir, henchDir, rexDir, provider,
        // Only use the explicit taskId for the first iteration;
        // subsequent iterations autoselect the next task
        i === 0 ? taskId : undefined,
        dryRun, model, spawnModel, maxTurns, tokenBudget,
        review,
        combinedExcludedIds,
        epicId,
        tags,
        undefined,
        rollbackOnFailure,
        yes,
        extraContext,
        autonomous,
        undefined,
        permissionMode,
      );

      // Track attempt count for the selected task
      if (selectedTaskId) {
        const attemptCount = attemptTracker.incrementAndGetCount(selectedTaskId);
        if (attemptCount >= 3 && !forcedExclusionIds.has(selectedTaskId)) {
          forcedExclusionIds.add(selectedTaskId);
          // Note: taskTitle would be in the original runOne result, not in status
          // We could enhance this later, but for now we just log the taskId
          info(`\n${colorWarn(`Forced advancement: task "${selectedTaskId}" has reached 3 attempts in this run. Excluding from next iteration.`)}`);
        }
      }

      // Emit quota log line(s) at the inter-run boundary.
      await emitQuotaLog();

      // Token exhaustion with a known refresh time: suspend until quota resets,
      // issue exactly one retry, emit outcome notification, and exit iterations.
      if (isTokenExhaustionStatus(status) && runTokenRefreshAt) {
        const refreshDate = new Date(runTokenRefreshAt);
        isInTokenWait = true;
        const completed_ = await waitForTokenRefresh(refreshDate, ac.signal);
        isInTokenWait = false;
        if (!completed_) {
          // Interrupted by Ctrl+C during wait
          info("\nToken-refresh wait interrupted by user — stopping.");
          break;
        }
        // Retry once (regardless of outcome, iterations exit after the retry)
        let retryResult: Awaited<ReturnType<typeof runOne>>;
        try {
          retryResult = await runOne(
            dir, henchDir, rexDir, provider,
            undefined, // autoselect (same task will be picked — still pending)
            dryRun, model, spawnModel, maxTurns, tokenBudget,
            review,
            undefined,
            epicId,
            tags,
            undefined,
            rollbackOnFailure,
            yes,
            extraContext,
            autonomous,
            undefined,
            permissionMode,
          );
        } catch (retryErr) {
          const msg = (retryErr as Error).message ?? String(retryErr);
          info(`\n${formatTokenRefreshRetryOutcome("failed", msg)}`);
          break;
        }
        info(`\n${formatTokenRefreshRetryOutcome(retryResult.status, retryResult.error)}`);
        break;
      }

      if (!shouldContinueLoop(status)) {
        if (isNonRetriableError(status)) {
          // Non-retriable hard failure: terminate with structured notification
          // and non-zero exit code.
          info(`\n${formatNonTokenFailureNotification(status, runError, runChangedFileCount)}`);
          process.exitCode = 1;
          break;
        }
        // Token exhaustion without refresh timestamp: notify and stop.
        if (isTokenExhaustionStatus(status)) {
          info(`\n${formatNonTokenFailureNotification(status, runError, runChangedFileCount)}`);
          break;
        }
      }

      if (dryRun) break;

      if (status === "error_transient") {
        info(`\n${colorWarn(`Transient error on iteration ${i + 1}, continuing to next task...`)}`);
      }
    }
  } finally {
    process.removeListener("SIGINT", onSignal);
  }
}

// ---------------------------------------------------------------------------
// Continuous loop mode (--loop)
// ---------------------------------------------------------------------------

async function runLoop(
  dir: string,
  henchDir: string,
  rexDir: string,
  provider: "cli" | "api",
  taskId: string | undefined,
  dryRun: boolean,
  model: string | undefined,
  spawnModel: string | undefined,
  maxTurns: number | undefined,
  tokenBudget: number | undefined,
  pauseMs: number,
  maxFailedAttempts: number,
  review: boolean,
  epicId?: string,
  tags?: string[],
  queue?: ExecutionQueue,
  priorityOverride?: string,
  rollbackOnFailure?: boolean,
  yes?: boolean,
  extraContext?: string,
  autonomous?: boolean,
  permissionMode?: PermissionMode,
): Promise<void> {
  // Graceful shutdown via SIGINT (Ctrl-C)
  const ac = new AbortController();
  let stopping = false;
  // True while waitForTokenRefresh is active. The SIGINT handler uses this to
  // suppress the rollback prompt: when the loop is waiting for token quota to
  // reset there is nothing to roll back (the last run terminated cleanly due to
  // quota exhaustion, not a code-level failure).
  let isInTokenWait = false;

  const onSignal = () => {
    if (stopping) {
      // Second Ctrl+C before the prompt is ready — force exit immediately.
      // (Once the prompt is active, promptRollbackOnInterrupt installs its own
      //  force-exit handler and this path is unreachable.)
      process.exit(1);
    }
    stopping = true;
    ac.abort();
    if (queue) queue.drain();

    // During a token-replenishment wait the abort signal above is enough to
    // unblock waitForTokenRefresh; there is nothing to roll back (the run
    // terminated cleanly due to quota), so skip the rollback prompt entirely.
    if (isInTokenWait) {
      process.exit(1);
      return;
    }

    // Show the rollback prompt. Any non-Y input exits immediately without
    // rollback. Y triggers revertChanges() then exits. Second Ctrl+C while
    // the prompt is open force-exits via promptRollbackOnInterrupt's own handler.
    void promptRollbackOnInterrupt().then(async (doRollback) => {
      if (doRollback) {
        try { await revertChanges(dir); } catch { /* best-effort */ }
        process.exit(0);
      } else {
        process.exit(1);
      }
    }).catch(() => process.exit(1));
  };

  process.on("SIGINT", onSignal);

  let completed = 0;
  // Tracks per-task outcomes when a tag filter is active (e.g. self-heal mode).
  const taggedCompletedItems: CompletedItem[] = [];
  // Track attempt counts per task ID within this run invocation
  const attemptTracker = createAttemptTracker();
  // Tasks excluded from selection due to reaching 3 attempts
  const forcedExclusionIds = new Set<string>();
  // Track consecutive failures per loop invocation (3-strike auto-cancel)
  const consecutiveFailureCounter = new ConsecutiveFailureCounter();

  try {
    const scope = epicId ? "epic tasks" : "all tasks";
    const tagNote = tags?.length ? ` [tag filter: ${tags.join(", ")}]` : "";
    info(`Loop mode: running continuously until ${scope} complete or interrupted (Ctrl+C to stop)${tagNote}`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (stopping) {
        info(`\nLoop stopped by user after ${completed} task(s).`);
        break;
      }

      completed++;
      // Banner between iterations: not emitted before the first iteration.
      if (completed > 1) {
        info(`\n${formatIterationBanner(completed)}`);
      }

      // Show queue status if there are pending tasks
      if (queue) logQueueStatus(queue);

      // Compute stuck tasks before each iteration so that
      // recently-stuck tasks are automatically skipped
      const isAutoselect = completed > 1 || !taskId;
      const stuckIds = isAutoselect
        ? await loadStuckTaskIds(henchDir, maxFailedAttempts)
        : undefined;

      let status: string;
      let runError: string | undefined;
      let runChangedFileCount = 0;
      let runTokenRefreshAt: string | undefined;
      try {
        // Resolve scheduling priority from task metadata before enqueuing.
        // This lets high-priority tasks bypass normal queue position.
        const effectiveTaskId = completed === 1 ? taskId : undefined;
        // Combine stuck tasks with tasks that reached max attempts
        const combinedExcludedIds = stuckIds
          ? new Set([...stuckIds, ...forcedExclusionIds])
          : forcedExclusionIds;
        let schedulingPriority: TaskPriority = "medium";
        if (queue) {
          const store = await resolveStore(rexDir);
          schedulingPriority = await peekNextTaskPriority(
            store, effectiveTaskId, priorityOverride, combinedExcludedIds, epicId, tags,
          );
          await queue.acquire(effectiveTaskId ?? "auto", schedulingPriority);
        }

        try {
          const result = await runOne(
            dir, henchDir, rexDir, provider,
            // Only use explicit taskId on the very first iteration
            effectiveTaskId,
            dryRun, model, spawnModel, maxTurns, tokenBudget,
            review,
            combinedExcludedIds,
            epicId,
            tags,
            undefined,
            rollbackOnFailure,
            yes,
            extraContext,
            autonomous,
            completed,
            permissionMode,
          );
          status = result.status;
          runError = result.error;
          runChangedFileCount = result.changedFileCount;
          runTokenRefreshAt = result.tokenRefreshAt;

          // Track consecutive failures for 3-strike auto-cancel.
          // Uses isFailureStatus (not !shouldContinueLoop) so that
          // error_transient and cancelled — which keep the loop iterating —
          // still count toward the threshold instead of resetting the counter.
          // Token-exhaustion runs that will be retried via waitForTokenRefresh
          // are not counted here — the loop breaks immediately after the retry.
          if (isFailureStatus(status) && !runTokenRefreshAt) {
            consecutiveFailureCounter.recordFailure(result.selectedTaskId || "unknown");
          } else if (!runTokenRefreshAt) {
            consecutiveFailureCounter.recordSuccess();
          }

          // Track attempt count for the selected task
          if (result.selectedTaskId) {
            const attemptCount = attemptTracker.incrementAndGetCount(result.selectedTaskId);
            if (attemptCount >= 3 && !forcedExclusionIds.has(result.selectedTaskId)) {
              forcedExclusionIds.add(result.selectedTaskId);
              info(`\n${colorWarn(`Forced advancement: task "${result.taskTitle}" has reached 3 attempts in this run. Excluding from next selection.`)}`);
            }
          }

          if (tags?.length) {
            taggedCompletedItems.push({ title: result.taskTitle, status: result.status });
          }
          // Close the banner opened by the lifecycle loop. Mirrors the
          // start banner's format so each run is visually bracketed in
          // long --loop transcripts.
          section(`Agent Run #${completed}${model ? ` (${model})` : ""} end`);
        } finally {
          // Release the queue slot after the task completes
          if (queue) queue.release();
        }
      } catch (err) {
        if (isNoTasksError(err)) {
          const scope = epicId ? " in epic" : "";
          if (tags?.length) {
            printTagFilterCompletionSummary(tags, taggedCompletedItems, completed - 1);
          } else {
            info(`\nAll tasks${scope} complete — loop finished after ${completed - 1} task(s).`);
          }
          break;
        }
        throw err;
      }

      // After each completed task, check whether any tagged items remain.
      // This satisfies the "evaluated after each task" requirement and avoids
      // a spurious extra iteration that would end in isNoTasksError.
      if (tags?.length && !dryRun) {
        const stillPending = await hasPendingTaggedTasks(rexDir, tags);
        if (!stillPending) {
          printTagFilterCompletionSummary(tags, taggedCompletedItems, completed);
          break;
        }
      }

      // Emit quota log line(s) at the inter-run boundary.
      await emitQuotaLog();

      // Token-exhaustion with a known refresh time: suspend until quota resets,
      // issue exactly one retry, emit outcome notification, and exit the loop.
      // No consecutive-failure counter is incremented for the wait period.
      if (isTokenExhaustionStatus(status) && runTokenRefreshAt) {
        const refreshDate = new Date(runTokenRefreshAt);
        isInTokenWait = true;
        const completed_ = await waitForTokenRefresh(refreshDate, ac.signal);
        isInTokenWait = false;
        if (!completed_) {
          // Interrupted by Ctrl-C during wait
          info("\nToken-refresh wait interrupted by user — exiting loop.");
          break;
        }
        // Retry once (regardless of outcome, loop exits after)
        let retryResult: Awaited<ReturnType<typeof runOne>>;
        try {
          retryResult = await runOne(
            dir, henchDir, rexDir, provider,
            undefined, // autoselect (same task will be picked — still pending)
            dryRun, model, spawnModel, maxTurns, tokenBudget,
            review,
            undefined,
            epicId,
            tags,
            undefined,
            rollbackOnFailure,
            yes,
            extraContext,
            autonomous,
            completed + 1,
            permissionMode,
          );
        } catch (retryErr) {
          const msg = (retryErr as Error).message ?? String(retryErr);
          info(`\n${formatTokenRefreshRetryOutcome("failed", msg)}`);
          break;
        }
        info(`\n${formatTokenRefreshRetryOutcome(retryResult.status, retryResult.error)}`);
        break;
      }

      // Check for 3-strike auto-cancel on consecutive failures
      if (consecutiveFailureCounter.shouldCancel()) {
        const cancelMessage = consecutiveFailureCounter.getCancellationMessage();
        info(`\n${red(cancelMessage)}`);
        break;
      }

      if (!shouldContinueLoop(status)) {
        if (isNonRetriableError(status)) {
          // Non-retriable hard failure: terminate the loop immediately,
          // emit a structured error notification (with changed-file count),
          // and signal non-zero exit.
          info(`\n${formatNonTokenFailureNotification(status, runError, runChangedFileCount)}`);
          process.exitCode = 1;
          break;
        }
        // Token exhaustion without refresh timestamp: treat as non-retriable,
        // delegate to the same notification path as hard failures.
        if (isTokenExhaustionStatus(status)) {
          info(`\n${formatNonTokenFailureNotification(status, runError, runChangedFileCount)}`);
          break;
        }
      }

      if (dryRun) {
        info("\nDry run — stopping after one iteration.");
        break;
      }

      if (status === "error_transient") {
        info(`\n${colorWarn("Transient error, continuing to next task...")}`);
      }

      // Pause between tasks (interruptible)
      if (!stopping && pauseMs > 0) {
        info(`\n${formatPauseMessage(pauseMs, "task")}`);
        await loopPause(pauseMs, ac.signal);
      }

      // Emit a pink separator at each loop-iteration boundary so long
      // transcripts are easy to scan.  Suppressed entirely when color is
      // disabled (NO_COLOR=1 or non-TTY without FORCE_COLOR) — no plain-text
      // fallback, because a bare ─── line would add noise without the colour
      // distinction that makes it useful.
      if (isColorEnabled()) {
        info(`\n${formatLoopIterationSeparator()}`);
      }
    }
  } finally {
    process.removeListener("SIGINT", onSignal);
  }
}

// ---------------------------------------------------------------------------
// Epic-by-epic execution mode (--epic-by-epic)
// ---------------------------------------------------------------------------

/**
 * Per-epic summary collected during epic-by-epic execution.
 */
export interface EpicRunSummary {
  id: string;
  title: string;
  tasksCompleted: number;
  tasksFailed: number;
  /** "completed" | "no_actionable_tasks" | "skipped" | "interrupted" */
  outcome: string;
}

/**
 * Collect ordered list of epics that have actionable tasks.
 * Returns all epics in PRD order, including those that are fully complete
 * (so the caller can decide what to process).
 */
export async function getOrderedEpics(
  store: PRDStore,
): Promise<EpicScopeInfo[]> {
  const doc = await store.loadDocument();
  const epics = listEpics(doc.items);
  const result: EpicScopeInfo[] = [];
  for (const epic of epics) {
    const scopeInfo = await getEpicScopeInfo(store, epic.id);
    result.push(scopeInfo);
  }
  return result;
}

/**
 * Run tasks across all epics sequentially. For each epic that has
 * actionable tasks, runs tasks in a loop until the epic is complete,
 * blocked, or interrupted, then advances to the next epic.
 */
async function runEpicByEpic(
  dir: string,
  henchDir: string,
  rexDir: string,
  provider: "cli" | "api",
  dryRun: boolean,
  model: string | undefined,
  spawnModel: string | undefined,
  maxTurns: number | undefined,
  tokenBudget: number | undefined,
  pauseMs: number,
  maxFailedAttempts: number,
  review: boolean,
  queue?: ExecutionQueue,
  priorityOverride?: string,
  rollbackOnFailure?: boolean,
  yes?: boolean,
  extraContext?: string,
  autonomous?: boolean,
  permissionMode?: PermissionMode,
): Promise<void> {
  // Graceful shutdown via SIGINT (Ctrl-C)
  const ac = new AbortController();
  let stopping = false;

  const onSignal = () => {
    if (stopping) {
      process.exit(1);
    }
    stopping = true;
    ac.abort();
    if (queue) queue.drain();

    void promptRollbackOnInterrupt().then(async (doRollback) => {
      if (doRollback) {
        try { await revertChanges(dir); } catch { /* best-effort */ }
        process.exit(0);
      } else {
        process.exit(1);
      }
    }).catch(() => process.exit(1));
  };

  process.on("SIGINT", onSignal);

  const summaries: EpicRunSummary[] = [];

  try {
    const store = await resolveStore(rexDir);
    await assertSchemaCompatibility(store);
    const allEpics = await getOrderedEpics(store);

    if (allEpics.length === 0) {
      output("No epics found in PRD.");
      return;
    }

    // Filter to epics that need work
    const actionableEpics = allEpics.filter((e) => !e.isComplete);
    if (actionableEpics.length === 0) {
      output(formatRunSuccessMessage("✓ All epics are complete."));
      return;
    }

    info(`Epic-by-epic mode: ${actionableEpics.length} epic(s) to process\n`);
    for (const epic of actionableEpics) {
      const progress = `${epic.completedTasks}/${epic.totalTasks} tasks complete`;
      info(`  • ${epic.title} — ${progress}`);
    }

    for (let epicIdx = 0; epicIdx < actionableEpics.length; epicIdx++) {
      if (stopping) {
        // Mark remaining epics as interrupted
        for (let j = epicIdx; j < actionableEpics.length; j++) {
          summaries.push({
            id: actionableEpics[j].id,
            title: actionableEpics[j].title,
            tasksCompleted: 0,
            tasksFailed: 0,
            outcome: "interrupted",
          });
        }
        break;
      }

      const epic = actionableEpics[epicIdx];

      info(`\n${colorPink("═".repeat(60))}`);
      info(bold(`Epic ${epicIdx + 1}/${actionableEpics.length}: ${epic.title}`));
      info(colorPink("═".repeat(60)));

      // Re-check epic scope (tasks may have changed from prior epic's work)
      const freshScope = await getEpicScopeInfo(store, epic.id);

      if (freshScope.isComplete) {
        info(green(`✓ Epic "${epic.title}" is already complete.`));
        summaries.push({
          id: epic.id,
          title: epic.title,
          tasksCompleted: 0,
          tasksFailed: 0,
          outcome: "completed",
        });
        continue;
      }

      if (!freshScope.hasActionableTasks) {
        info(colorWarn(`⚠ Epic "${epic.title}" has no actionable tasks (${freshScope.totalTasks - freshScope.completedTasks} blocked/deferred).`));
        summaries.push({
          id: epic.id,
          title: epic.title,
          tasksCompleted: 0,
          tasksFailed: 0,
          outcome: "no_actionable_tasks",
        });
        continue;
      }

      const progress = `${freshScope.completedTasks}/${freshScope.totalTasks} tasks complete`;
      info(`Starting: ${freshScope.actionableTasks} actionable task(s), ${progress}`);

      let tasksCompleted = 0;
      let tasksFailed = 0;

      // Inner loop: run tasks within this epic
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (stopping) break;

        // Show queue status if there are pending tasks
        if (queue) logQueueStatus(queue);

        const stuckIds = await loadStuckTaskIds(henchDir, maxFailedAttempts);

        let status: string;
        let epicRunError: string | undefined;
        let epicChangedFileCount = 0;
        try {
          // Resolve scheduling priority from task metadata before enqueuing.
          // This lets high-priority tasks bypass normal queue position.
          if (queue) {
            const schedulingPriority = await peekNextTaskPriority(
              store, undefined, priorityOverride, stuckIds, epic.id,
            );
            await queue.acquire(epic.id, schedulingPriority);
          }

          try {
            const result = await runOne(
              dir, henchDir, rexDir, provider,
              undefined, // autoselect within epic
              dryRun, model, spawnModel, maxTurns, tokenBudget,
              review,
              stuckIds,
              epic.id,
              undefined, // tags (epic-by-epic doesn't apply a tag filter)
              undefined,
              rollbackOnFailure,
              yes,
              extraContext,
              autonomous,
              undefined,
              permissionMode,
            );
            status = result.status;
            epicRunError = result.error;
            epicChangedFileCount = result.changedFileCount;
          } finally {
            // Release the queue slot after the task completes
            if (queue) queue.release();
          }
        } catch (err) {
          if (isNoTasksError(err)) {
            // All tasks in this epic are done
            break;
          }
          throw err;
        }

        // Non-retriable hard failure: terminate inner loop and all remaining epics.
        // Emit a structured notification (with changed-file count) and exit non-zero.
        if (isNonRetriableError(status)) {
          info(`\n${formatNonTokenFailureNotification(status, epicRunError, epicChangedFileCount)}`);
          process.exitCode = 1;
          stopping = true;
          tasksFailed++;
          break;
        }

        // Emit quota log line(s) at the inter-run boundary.
        await emitQuotaLog();

        if (status === "completed") {
          tasksCompleted++;
        } else if (status === "failed" || status === "timeout" || status === "budget_exceeded") {
          tasksFailed++;
        }

        if (dryRun) {
          info("\nDry run — stopping after one task.");
          break;
        }

        // Re-check epic scope after each task
        const updated = await getEpicScopeInfo(store, epic.id);
        if (updated.isComplete) {
          info(`\n${green(`✓ Epic "${epic.title}" is now complete!`)}`);
          break;
        }
        if (!updated.hasActionableTasks) {
          info(`\n${colorWarn(`⚠ Epic "${epic.title}" has no more actionable tasks.`)}`);
          break;
        }

        // Pause between tasks (interruptible)
        if (!stopping && pauseMs > 0) {
          info(`\n${formatPauseMessage(pauseMs, "task")}`);
          await loopPause(pauseMs, ac.signal);
        }
      }

      const epicOutcome = stopping ? "interrupted" : (
        (await getEpicScopeInfo(store, epic.id)).isComplete
          ? "completed"
          : "no_actionable_tasks"
      );

      summaries.push({
        id: epic.id,
        title: epic.title,
        tasksCompleted,
        tasksFailed,
        outcome: epicOutcome,
      });

      if (dryRun) break;

      // Pause between epics (interruptible)
      if (!stopping && epicIdx < actionableEpics.length - 1 && pauseMs > 0) {
        info(`\n${formatPauseMessage(pauseMs, "epic")}`);
        await loopPause(pauseMs, ac.signal);
      }
    }

    // Print final summary
    printEpicByEpicSummary(summaries);
  } finally {
    process.removeListener("SIGINT", onSignal);
  }
}

/**
 * Print a summary table of epic-by-epic execution results.
 */
export function printEpicByEpicSummary(summaries: EpicRunSummary[]): void {
  info(`\n${colorPink("═".repeat(60))}`);
  info(bold("Epic-by-Epic Execution Summary"));
  info(colorPink("═".repeat(60)));

  let totalCompleted = 0;
  let totalFailed = 0;

  for (const s of summaries) {
    const icon =
      s.outcome === "completed" ? "✓" :
      s.outcome === "interrupted" ? "⊘" :
      s.outcome === "no_actionable_tasks" ? "⚠" :
      s.outcome === "skipped" ? "–" :
      "?";

    const stats = s.tasksCompleted > 0 || s.tasksFailed > 0
      ? ` (${green(String(s.tasksCompleted))} done, ${red(String(s.tasksFailed))} failed)`
      : "";

    output(`  ${icon} ${s.title} — ${s.outcome}${stats}`);
    totalCompleted += s.tasksCompleted;
    totalFailed += s.tasksFailed;
  }

  const epicsDone = summaries.filter((s) => s.outcome === "completed").length;
  output(`\nEpics: ${epicsDone}/${summaries.length} completed | Tasks: ${green(String(totalCompleted))} done, ${red(String(totalFailed))} failed`);
}
