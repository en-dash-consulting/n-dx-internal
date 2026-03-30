/**
 * Sourcevision API routes — structured access to analysis data.
 *
 * All endpoints are under /api/sv/.
 *
 * GET  /api/sv/manifest              — analysis metadata and git info
 * GET  /api/sv/inventory             — file listing with metadata
 * GET  /api/sv/imports               — dependency graph
 * GET  /api/sv/zones                 — architectural zone map
 * GET  /api/sv/components            — React component catalog
 * GET  /api/sv/context               — full CONTEXT.md contents
 * GET  /api/sv/frameworks             — detected frameworks and tech stack
 * GET  /api/sv/db-packages           — database layer detection from external imports
 * GET  /api/sv/phases                — 4 grouped analysis phase objects with aggregated status
 * GET  /api/sv/summary               — summary stats across all analyses
 * POST /api/sv/phases/:n/run         — trigger grouped phase (1–4), runs constituent modules in sequence
 * POST /api/sv/phases/:n/reset       — reset all constituent modules in a grouped phase to pending
 *
 * The former /api/sv/pr-markdown endpoint has been removed.
 * PR description generation is now handled by the /pr-description Claude Code skill.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnManaged, type ManagedChild } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse } from "./types.js";
import type { WebSocketBroadcaster } from "./websocket.js";
import { DATA_FILES, buildDbPackagesResponse } from "../shared/index.js";
import { isAnalysisRunning } from "./domain-gateway.js";

const SV_PREFIX = "/api/sv/";

/** Internal module definitions — maps module IDs to phase numbers and metadata. */
const PHASE_DEFINITIONS = [
  { id: "inventory", phase: 1, name: "Inventory", description: "Catalog all project files with metadata (size, language, extension)" },
  { id: "imports", phase: 2, name: "Imports", description: "Build the dependency graph from import/require statements" },
  { id: "classifications", phase: 3, name: "Classifications", description: "Classify files by archetype (utility, entrypoint, route-handler, etc.)" },
  { id: "zones", phase: 4, name: "Zones", description: "Detect architectural zones using community detection on the import graph" },
  { id: "components", phase: 5, name: "Components", description: "Catalog React/Preact components, props, and usage relationships" },
  { id: "callgraph", phase: 6, name: "Call Graph", description: "Analyze function-level call relationships and cross-zone patterns" },
  { id: "configsurface", phase: 7, name: "Config Surface", description: "Detect environment variables, config file references, and global constants" },
  { id: "frameworks", phase: 8, name: "Frameworks", description: "Detect languages, frameworks, and runtime stack" },
] as const;

/**
 * Grouped phase definitions — maps 4 user-facing groups to internal modules.
 *
 * Group 1 (Scan):          inventory + imports + configsurface + frameworks
 * Group 2 (Classify):      classifications + components
 * Group 3 (Architecture):  zones + callgraph
 * Group 4 (Deep Analysis): zone enrichment passes 2–4 via --phase=4 --full
 */
/** Shape of a grouped phase definition. */
interface GroupedPhaseDef {
  group: number;
  name: string;
  description: string;
  moduleIds: readonly string[];
  modulePhases: readonly number[];
  /** When true, runs sourcevision analyze --phase=4 --full instead of individual modules. */
  fullMode?: boolean;
}

const GROUPED_PHASES: readonly GroupedPhaseDef[] = [
  {
    group: 1,
    name: "Scan",
    description: "Catalog files, build dependency graph, detect configuration surface, and identify frameworks",
    moduleIds: ["inventory", "imports", "configsurface", "frameworks"],
    modulePhases: [1, 2, 7, 8],
  },
  {
    group: 2,
    name: "Classify",
    description: "Classify files by archetype and catalog React/Preact components",
    moduleIds: ["classifications", "components"],
    modulePhases: [3, 5],
  },
  {
    group: 3,
    name: "Architecture",
    description: "Detect architectural zones and analyze function-level call patterns",
    moduleIds: ["zones", "callgraph"],
    modulePhases: [4, 6],
  },
  {
    group: 4,
    name: "Deep Analysis",
    description: "Zone enrichment passes 2\u20134 and meta-evaluation for comprehensive insights",
    moduleIds: [],
    modulePhases: [],
    fullMode: true,
  },
];

/** Valid grouped phase numbers (1–4). */
const VALID_GROUP_NUMBERS = new Set<number>(GROUPED_PHASES.map((g) => g.group));

/**
 * Check phase prerequisite completion.
 *
 * Phase ordering: 1 → 2 → 3 → 4. Each phase (except 1) requires the
 * previous phase to be complete before it can run.
 *
 * Returns an error message string if prerequisites are not met, or null if OK.
 */
function getPhasePrerequisiteError(
  group: number,
  ctx: ServerContext,
): string | null {
  // Phase 1 is always runnable — no prerequisites
  if (group <= 1) return null;

  const manifest = loadDataFile(ctx, DATA_FILES.manifest) as Record<string, unknown> | null;
  const manifestModules = manifest
    ? (((manifest as Record<string, unknown>).modules ?? {}) as Record<string, Record<string, unknown>>)
    : null;

  // Check zones.json for enrichmentPass (for group 4 prerequisite on group 3)
  const zonesData = group === 4
    ? loadDataFile(ctx, DATA_FILES.zones) as Record<string, unknown> | null
    : null;

  // Check each prerequisite group in order (all phases before `group` must be complete)
  for (let prereq = 1; prereq < group; prereq++) {
    const prereqDef = GROUPED_PHASES.find((g) => g.group === prereq)!;
    let isComplete: boolean;

    if (prereqDef.group === 4) {
      // Group 4 uses zones enrichmentPass
      const enrichmentPass = zonesData ? (zonesData.enrichmentPass as number | undefined) : undefined;
      isComplete = enrichmentPass != null && enrichmentPass >= 4;
    } else {
      // Groups 1–3: all constituent modules must be complete
      isComplete = prereqDef.moduleIds.length > 0 && prereqDef.moduleIds.every((moduleId) => {
        const mod = manifestModules?.[moduleId];
        return mod?.status === "complete";
      });
    }

    if (!isComplete) {
      return `Phase ${group} (${GROUPED_PHASES.find((g) => g.group === group)!.name}) requires Phase ${prereq} (${prereqDef.name}) to be complete first. Run Phase ${prereq} before attempting Phase ${group}.`;
    }
  }

  return null;
}

// ── Singleton guard for grouped phase execution ──────────────────────────

/** Active grouped phase execution state. null when idle. */
let activeGroupRun: {
  /** Grouped phase number (1–4). */
  group: number;
  /** Name of the grouped phase for display. */
  groupName: string;
  /** Current module being executed. */
  currentModulePhase: number;
  currentModuleId: string;
  /** Remaining module phases to run after the current one completes. */
  remainingModulePhases: number[];
  /** Spawned process handle. */
  handle: ManagedChild;
  /** When the grouped phase execution started. */
  startedAt: string;
  /** Server context (captured at run start for async chain). */
  ctx: ServerContext;
  /** Broadcast function (captured at run start for async chain). */
  broadcast: WebSocketBroadcaster | undefined;
} | null = null;

/** Broadcast a phase status update over WebSocket. */
function broadcastPhaseUpdate(
  broadcast: WebSocketBroadcaster | undefined,
  payload: Record<string, unknown>,
): void {
  if (!broadcast) return;
  broadcast({
    type: "sv:phase-update",
    ...payload,
    timestamp: new Date().toISOString(),
  });
}

// ── Sequential module runner ─────────────────────────────────────────────

/** Resolve the sourcevision binary path and build spawn arguments. */
function resolveSvBinary(
  ctx: ServerContext,
  extraArgs: string[],
): { binPath: string; binArgs: string[] } {
  const svBin = join(ctx.projectDir, "node_modules", ".bin", "sourcevision");
  const svFallback = join(ctx.projectDir, "packages", "sourcevision", "dist", "cli", "index.js");
  const args = ["analyze", ...extraArgs, ctx.projectDir];
  const binPath = existsSync(svBin) ? svBin : "node";
  const binArgs = existsSync(svBin) ? args : [svFallback, ...args];
  return { binPath, binArgs };
}

/**
 * Spawn the next module in the active group run.
 * Called initially and then recursively on each module completion.
 */
function spawnNextModuleInGroup(): void {
  if (!activeGroupRun) return;

  const { group, currentModulePhase, currentModuleId, ctx, broadcast, startedAt } = activeGroupRun;

  const { binPath, binArgs } = resolveSvBinary(ctx, [`--phase=${currentModulePhase}`]);

  const handle = spawnManaged(binPath, binArgs, {
    cwd: ctx.projectDir,
    stdio: "pipe",
    env: { ...process.env },
  });

  activeGroupRun.handle = handle;

  // Broadcast module-level running state
  broadcastPhaseUpdate(broadcast, {
    group,
    status: "running",
    module: currentModuleId,
    modulePhase: currentModulePhase,
    startedAt,
  });

  // Handle module completion asynchronously
  handle.done
    .then((result) => {
      // Guard: run may have been cancelled/shutdown
      if (!activeGroupRun || activeGroupRun.group !== group) return;

      if (result.exitCode !== 0) {
        // Module failed — stop the group
        broadcastPhaseUpdate(broadcast, {
          group,
          status: "error",
          module: currentModuleId,
          modulePhase: currentModulePhase,
          finishedAt: new Date().toISOString(),
          exitCode: result.exitCode,
          ...(result.stderr ? { error: result.stderr.slice(-500) } : {}),
        });
        activeGroupRun = null;
        return;
      }

      // Module succeeded — check if more modules remain
      const remaining = activeGroupRun.remainingModulePhases;
      if (remaining.length === 0) {
        // Group complete
        broadcastPhaseUpdate(broadcast, {
          group,
          status: "complete",
          startedAt,
          finishedAt: new Date().toISOString(),
        });
        activeGroupRun = null;
        return;
      }

      // Advance to next module
      const nextPhase = remaining[0];
      const nextDef = PHASE_DEFINITIONS.find((d) => d.phase === nextPhase);
      activeGroupRun.currentModulePhase = nextPhase;
      activeGroupRun.currentModuleId = nextDef?.id ?? `phase-${nextPhase}`;
      activeGroupRun.remainingModulePhases = remaining.slice(1);

      // Recurse to spawn next module
      spawnNextModuleInGroup();
    })
    .catch((err) => {
      if (!activeGroupRun || activeGroupRun.group !== group) return;
      broadcastPhaseUpdate(broadcast, {
        group,
        status: "error",
        module: currentModuleId,
        modulePhase: currentModulePhase,
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
      activeGroupRun = null;
    });
}

// ── Phase run shutdown ───────────────────────────────────────────────────

/**
 * Terminate any running phase execution. Called during server shutdown.
 * Returns true if a process was terminated.
 */
export function shutdownPhaseRun(): boolean {
  if (!activeGroupRun) return false;
  activeGroupRun.handle.kill("SIGTERM");
  activeGroupRun = null;
  return true;
}

// ── Data file helpers ────────────────────────────────────────────────────

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

/** Handle sourcevision API requests. Returns true if the request was handled. */
export function handleSourcevisionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean {
  const url = req.url || "/";
  const method = req.method || "GET";
  const queryIdx = url.indexOf("?");
  const routePath = queryIdx === -1 ? url : url.slice(0, queryIdx);
  const query = queryIdx === -1 ? "" : url.slice(queryIdx + 1);

  if (!routePath.startsWith(SV_PREFIX)) return false;

  const path = routePath.slice(SV_PREFIX.length);
  const params = new URLSearchParams(query);

  // ── POST routes ────────────────────────────────────────────────────────

  // POST /api/sv/phases/:n/run — trigger a grouped phase (1–4)
  const phaseRunMatch = path.match(/^phases\/(\d+)\/run$/);
  if (method === "POST" && phaseRunMatch) {
    const group = parseInt(phaseRunMatch[1], 10);

    // Validate group number
    if (!VALID_GROUP_NUMBERS.has(group)) {
      errorResponse(res, 400, `Invalid phase number: ${group}. Valid phases are 1–4.`);
      return true;
    }

    // Singleton guard — only one group can run at a time
    if (activeGroupRun) {
      jsonResponse(res, 409, {
        error: "A phase is already running",
        activePhase: activeGroupRun.group,
        activePhaseId: activeGroupRun.groupName,
        startedAt: activeGroupRun.startedAt,
      });
      return true;
    }

    // Cross-process guard — check manifest for externally running analysis
    // Uses the shared isAnalysisRunning() which also auto-clears stale PID locks.
    const lockCheck = isAnalysisRunning(ctx.projectDir);
    if (lockCheck.running) {
      jsonResponse(res, 409, {
        error: "Analysis is already running (external process)",
        runningModules: lockCheck.modules,
        source: "manifest",
      });
      return true;
    }

    // Phase prerequisite enforcement — phases must run in order (1 → 2 → 3 → 4)
    const prereqError = getPhasePrerequisiteError(group, ctx);
    if (prereqError) {
      jsonResponse(res, 400, {
        error: prereqError,
        code: "PREREQUISITE_NOT_MET",
        phase: group,
      });
      return true;
    }

    const groupDef = GROUPED_PHASES.find((g) => g.group === group)!;
    const startedAt = new Date().toISOString();

    // Group 4 (Deep Analysis) — special: runs --phase=4 --full for zone enrichment
    if (groupDef.fullMode) {
      const firstPhase = 4;
      const firstModuleId = "zones";

      const { binPath, binArgs } = resolveSvBinary(ctx, ["--phase=4", "--full"]);

      const handle = spawnManaged(binPath, binArgs, {
        cwd: ctx.projectDir,
        stdio: "pipe",
        env: { ...process.env },
      });

      activeGroupRun = {
        group,
        groupName: groupDef.name,
        currentModulePhase: firstPhase,
        currentModuleId: firstModuleId,
        remainingModulePhases: [],
        handle,
        startedAt,
        ctx,
        broadcast,
      };

      // Broadcast initial running state
      broadcastPhaseUpdate(broadcast, {
        group,
        status: "running",
        module: firstModuleId,
        modulePhase: firstPhase,
        startedAt,
      });

      // Handle completion asynchronously
      handle.done
        .then((result) => {
          if (!activeGroupRun || activeGroupRun.group !== group) return;
          const isSuccess = result.exitCode === 0;
          broadcastPhaseUpdate(broadcast, {
            group,
            status: isSuccess ? "complete" : "error",
            startedAt,
            finishedAt: new Date().toISOString(),
            exitCode: result.exitCode,
            ...((!isSuccess && result.stderr) ? { error: result.stderr.slice(-500) } : {}),
          });
          activeGroupRun = null;
        })
        .catch((err) => {
          if (!activeGroupRun || activeGroupRun.group !== group) return;
          broadcastPhaseUpdate(broadcast, {
            group,
            status: "error",
            startedAt,
            finishedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
          });
          activeGroupRun = null;
        });

      jsonResponse(res, 202, {
        group,
        groupName: groupDef.name,
        status: "started",
        startedAt,
        modules: [firstModuleId],
      });
      return true;
    }

    // Groups 1–3: run constituent modules sequentially
    const phases = [...groupDef.modulePhases];
    if (phases.length === 0) {
      errorResponse(res, 400, `Phase ${group} has no constituent modules.`);
      return true;
    }

    const firstPhase = phases[0];
    const firstDef = PHASE_DEFINITIONS.find((d) => d.phase === firstPhase)!;

    // Initialize group run state
    activeGroupRun = {
      group,
      groupName: groupDef.name,
      currentModulePhase: firstPhase,
      currentModuleId: firstDef.id,
      remainingModulePhases: phases.slice(1),
      handle: null as unknown as ManagedChild, // Set by spawnNextModuleInGroup
      startedAt,
      ctx,
      broadcast,
    };

    // Start the first module
    spawnNextModuleInGroup();

    // Return immediately with tracking info
    jsonResponse(res, 202, {
      group,
      groupName: groupDef.name,
      status: "started",
      startedAt,
      modules: groupDef.moduleIds,
    });
    return true;
  }

  // POST /api/sv/phases/:n/reset — reset all modules in a grouped phase to pending
  const phaseResetMatch = path.match(/^phases\/(\d+)\/reset$/);
  if (method === "POST" && phaseResetMatch) {
    const group = parseInt(phaseResetMatch[1], 10);

    // Validate group number
    if (!VALID_GROUP_NUMBERS.has(group)) {
      errorResponse(res, 400, `Invalid phase number: ${group}. Valid phases are 1–4.`);
      return true;
    }

    const groupDef = GROUPED_PHASES.find((g) => g.group === group)!;
    const manifestPath = join(ctx.svDir, DATA_FILES.manifest);

    // Load manifest
    const manifest = loadDataFile(ctx, DATA_FILES.manifest) as Record<string, unknown> | null;
    if (!manifest) {
      errorResponse(res, 404, "No manifest data. Run 'sourcevision analyze' first.");
      return true;
    }

    // Reset all constituent module entries
    const modules = (manifest.modules ?? {}) as Record<string, Record<string, unknown>>;
    const resetModuleIds: string[] = [];

    for (const moduleId of groupDef.moduleIds) {
      const mod = modules[moduleId];
      if (mod) {
        delete mod.startedAt;
        delete mod.completedAt;
        delete mod.error;
        mod.status = "pending";
      } else {
        modules[moduleId] = { status: "pending" };
      }
      resetModuleIds.push(moduleId);
    }
    manifest.modules = modules;

    // Write back to manifest.json
    try {
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    } catch (err) {
      errorResponse(res, 500, `Failed to write manifest: ${err instanceof Error ? err.message : String(err)}`);
      return true;
    }

    // Broadcast reset state for the group
    broadcastPhaseUpdate(broadcast, {
      group,
      status: "pending",
      modules: resetModuleIds,
    });

    jsonResponse(res, 200, {
      group,
      groupName: groupDef.name,
      status: "pending",
      modules: resetModuleIds,
    });
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

  // GET /api/sv/inventory — supports ?offset=N&limit=N for pagination
  if (path === "inventory") {
    const data = loadDataFile(ctx, DATA_FILES.inventory) as Record<string, unknown> | null;
    if (!data) {
      errorResponse(res, 404, "No inventory data. Run 'sourcevision analyze' first.");
      return true;
    }

    // Support pagination via ?offset=N&limit=N query parameters
    const offsetStr = params.get("offset");
    const limitStr = params.get("limit");
    const offset = offsetStr ? Math.max(0, parseInt(offsetStr, 10) || 0) : 0;
    const limit = limitStr ? Math.max(0, parseInt(limitStr, 10) || 0) : 0;

    if ((offset > 0 || limit > 0) && Array.isArray(data.files)) {
      const allFiles = data.files as unknown[];
      const total = allFiles.length;
      const slicedFiles = limit > 0
        ? allFiles.slice(offset, offset + limit)
        : allFiles.slice(offset);

      jsonResponse(res, 200, {
        ...data,
        files: slicedFiles,
        pagination: { offset, limit: limit || total - offset, total },
      });
    } else {
      jsonResponse(res, 200, data);
    }
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

  // GET /api/sv/frameworks — detected frameworks and tech stack
  if (path === "frameworks") {
    const data = loadDataFile(ctx, DATA_FILES.frameworks);
    if (!data) {
      // Return empty defaults instead of 404 — the viewer uses frameworks
      // for tab visibility and should degrade gracefully when no analysis exists.
      jsonResponse(res, 200, {
        frameworks: [],
        summary: { totalDetected: 0, byCategory: {}, byLanguage: {} },
      });
      return true;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/db-packages — database layer detection from external imports
  if (path === "db-packages") {
    const data = loadDataFile(ctx, DATA_FILES.imports) as Record<string, unknown> | null;
    if (!data) {
      errorResponse(res, 404, "No imports data. Run 'sourcevision analyze' first.");
      return true;
    }
    const external = Array.isArray(data.external) ? data.external : [];
    jsonResponse(res, 200, buildDbPackagesResponse(external));
    return true;
  }

  // GET /api/sv/phases — 4 grouped analysis phases with aggregated status
  if (path === "phases") {
    // Run the shared concurrency check FIRST — it auto-clears stale PID locks
    // in the manifest, so subsequent reads see accurate status.
    const lockCheck = isAnalysisRunning(ctx.projectDir);
    const anyRunning = activeGroupRun !== null || lockCheck.running;

    const manifest = loadDataFile(ctx, DATA_FILES.manifest) as Record<string, unknown> | null;
    const manifestModules = manifest
      ? (((manifest as Record<string, unknown>).modules ?? {}) as Record<string, Record<string, unknown>>)
      : null;

    // Optionally check zones.json for enrichmentPass (for group 4 status)
    const zonesData = loadDataFile(ctx, DATA_FILES.zones) as Record<string, unknown> | null;
    const enrichmentPass = zonesData ? (zonesData.enrichmentPass as number | undefined) : undefined;

    const phases = GROUPED_PHASES.map((groupDef) => {
      // Resolve constituent module statuses from manifest
      const moduleStatuses = groupDef.moduleIds.map((moduleId) => {
        const phaseDef = PHASE_DEFINITIONS.find((d) => d.id === moduleId);
        const mod = manifestModules?.[moduleId];
        return {
          id: moduleId,
          phase: phaseDef?.phase ?? 0,
          name: phaseDef?.name ?? moduleId,
          status: (mod?.status as string) ?? "pending",
          startedAt: (mod?.startedAt as string) ?? null,
          completedAt: (mod?.completedAt as string) ?? null,
          error: (mod?.error as string) ?? null,
        };
      });

      // Aggregate status from constituent modules
      let status: string;
      if (groupDef.group === 4) {
        // Group 4 (Deep Analysis): check activeGroupRun or enrichmentPass
        if (activeGroupRun?.group === 4) {
          status = "running";
        } else if (enrichmentPass != null && enrichmentPass >= 4) {
          status = "complete";
        } else {
          status = "pending";
        }
      } else if (moduleStatuses.length === 0) {
        status = "pending";
      } else if (moduleStatuses.some((m) => m.status === "running")) {
        status = "running";
      } else if (moduleStatuses.some((m) => m.status === "error")) {
        status = "error";
      } else if (moduleStatuses.every((m) => m.status === "complete")) {
        status = "complete";
      } else {
        status = "pending";
      }

      // Aggregate timestamps
      let startedAt: string | null = null;
      let completedAt: string | null = null;
      for (const m of moduleStatuses) {
        if (m.startedAt && (!startedAt || m.startedAt < startedAt)) {
          startedAt = m.startedAt;
        }
        if (m.completedAt && (!completedAt || m.completedAt > completedAt)) {
          completedAt = m.completedAt;
        }
      }
      // For group 4, use activeGroupRun timestamps if available
      if (groupDef.group === 4 && activeGroupRun?.group === 4) {
        startedAt = activeGroupRun.startedAt;
        completedAt = null;
      }

      // Aggregate error from constituent modules
      const errorModules = moduleStatuses.filter((m) => m.error);
      const error = errorModules.length > 0
        ? errorModules.map((m) => `${m.name}: ${m.error}`).join("; ")
        : null;

      return {
        group: groupDef.group,
        name: groupDef.name,
        description: groupDef.description,
        status,
        startedAt,
        completedAt,
        error,
        modules: moduleStatuses,
        prerequisiteMet: true as boolean,
        prerequisiteHint: null as string | null,
      };
    });

    // Second pass: compute prerequisite lock state now that all statuses are known
    for (const phase of phases) {
      if (phase.group <= 1) continue;
      for (let prereq = 1; prereq < phase.group; prereq++) {
        const prereqPhase = phases.find((p) => p.group === prereq);
        if (!prereqPhase || prereqPhase.status !== "complete") {
          const prereqDef = GROUPED_PHASES.find((g) => g.group === prereq)!;
          phase.prerequisiteMet = false;
          phase.prerequisiteHint = `Phase ${prereq} (${prereqDef.name}) must complete first`;
          break;
        }
      }
    }

    jsonResponse(res, 200, { phases, anyRunning });
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

  // GET /api/sv/pr-markdown (removed — migrated to /pr-description skill)
  if (path === "pr-markdown" || path === "pr-markdown/state") {
    jsonResponse(res, 410, {
      error: "The /api/sv/pr-markdown endpoint has been removed.",
      message: "PR description generation has moved to the /pr-description Claude Code skill. Run /pr-description in Claude Code instead.",
    });
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
