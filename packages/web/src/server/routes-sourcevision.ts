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
 * GET  /api/sv/db-packages           — database layer detection from external imports
 * GET  /api/sv/phases                — ordered analysis phase status from manifest modules
 * GET  /api/sv/summary               — summary stats across all analyses
 * POST /api/sv/phases/:phase/run     — trigger a single analysis phase
 * POST /api/sv/phases/:phase/reset   — clear phase status back to pending
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

/** Ordered analysis phase definitions. */
const PHASE_DEFINITIONS = [
  { id: "inventory", phase: 1, name: "Inventory", description: "Catalog all project files with metadata (size, language, extension)" },
  { id: "imports", phase: 2, name: "Imports", description: "Build the dependency graph from import/require statements" },
  { id: "classifications", phase: 3, name: "Classifications", description: "Classify files by archetype (utility, entrypoint, route-handler, etc.)" },
  { id: "zones", phase: 4, name: "Zones", description: "Detect architectural zones using community detection on the import graph" },
  { id: "components", phase: 5, name: "Components", description: "Catalog React/Preact components, props, and usage relationships" },
  { id: "callgraph", phase: 6, name: "Call Graph", description: "Analyze function-level call relationships and cross-zone patterns" },
  { id: "configsurface", phase: 7, name: "Config Surface", description: "Detect environment variables, config file references, and global constants" },
] as const;

/** Valid phase numbers (1–7). */
const VALID_PHASE_NUMBERS = new Set<number>(PHASE_DEFINITIONS.map((d) => d.phase));

// ── Singleton guard for phase execution ──────────────────────────────────

/** Active phase execution state. null when idle. */
let activePhaseRun: {
  phase: number;
  phaseId: string;
  handle: ManagedChild;
  startedAt: string;
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

// ── Phase run shutdown ───────────────────────────────────────────────────

/**
 * Terminate any running phase execution. Called during server shutdown.
 * Returns true if a process was terminated.
 */
export function shutdownPhaseRun(): boolean {
  if (!activePhaseRun) return false;
  activePhaseRun.handle.kill("SIGTERM");
  activePhaseRun = null;
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

  // POST /api/sv/phases/:phase/run — trigger a single analysis phase
  const phaseRunMatch = path.match(/^phases\/(\d+)\/run$/);
  if (method === "POST" && phaseRunMatch) {
    const phase = parseInt(phaseRunMatch[1], 10);

    // Validate phase number
    if (!VALID_PHASE_NUMBERS.has(phase)) {
      errorResponse(res, 400, `Invalid phase number: ${phase}. Valid phases are 1–7.`);
      return true;
    }

    // Singleton guard — only one phase can run at a time
    if (activePhaseRun) {
      jsonResponse(res, 409, {
        error: "A phase is already running",
        activePhase: activePhaseRun.phase,
        activePhaseId: activePhaseRun.phaseId,
        startedAt: activePhaseRun.startedAt,
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

    const phaseDef = PHASE_DEFINITIONS.find((d) => d.phase === phase)!;

    // Resolve sourcevision binary (same pattern as routes-hench.ts)
    const svBin = join(ctx.projectDir, "node_modules", ".bin", "sourcevision");
    const svFallback = join(ctx.projectDir, "packages", "sourcevision", "dist", "cli", "index.js");
    const args = ["analyze", `--phase=${phase}`, ctx.projectDir];

    const binPath = existsSync(svBin) ? svBin : "node";
    const binArgs = existsSync(svBin) ? args : [svFallback, ...args];

    const startedAt = new Date().toISOString();

    // Spawn the analysis process
    const handle = spawnManaged(binPath, binArgs, {
      cwd: ctx.projectDir,
      stdio: "pipe",
      env: { ...process.env },
    });

    // Track active execution
    activePhaseRun = { phase, phaseId: phaseDef.id, handle, startedAt };

    // Broadcast initial running state
    broadcastPhaseUpdate(broadcast, {
      phase,
      phaseId: phaseDef.id,
      status: "running",
      startedAt,
    });

    // Handle completion asynchronously
    handle.done
      .then((result) => {
        const isSuccess = result.exitCode === 0;
        broadcastPhaseUpdate(broadcast, {
          phase,
          phaseId: phaseDef.id,
          status: isSuccess ? "complete" : "error",
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode: result.exitCode,
          ...((!isSuccess && result.stderr) ? { error: result.stderr.slice(-500) } : {}),
        });
      })
      .catch((err) => {
        broadcastPhaseUpdate(broadcast, {
          phase,
          phaseId: phaseDef.id,
          status: "error",
          startedAt,
          finishedAt: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        if (activePhaseRun?.phase === phase) {
          activePhaseRun = null;
        }
      });

    // Return immediately with tracking info
    jsonResponse(res, 202, {
      phase,
      phaseId: phaseDef.id,
      phaseName: phaseDef.name,
      status: "started",
      startedAt,
    });
    return true;
  }

  // POST /api/sv/phases/:phase/reset — clear a phase back to pending
  const phaseResetMatch = path.match(/^phases\/(\d+)\/reset$/);
  if (method === "POST" && phaseResetMatch) {
    const phase = parseInt(phaseResetMatch[1], 10);

    // Validate phase number
    if (!VALID_PHASE_NUMBERS.has(phase)) {
      errorResponse(res, 400, `Invalid phase number: ${phase}. Valid phases are 1–7.`);
      return true;
    }

    const phaseDef = PHASE_DEFINITIONS.find((d) => d.phase === phase)!;
    const manifestPath = join(ctx.svDir, DATA_FILES.manifest);

    // Load manifest
    const manifest = loadDataFile(ctx, DATA_FILES.manifest) as Record<string, unknown> | null;
    if (!manifest) {
      errorResponse(res, 404, "No manifest data. Run 'sourcevision analyze' first.");
      return true;
    }

    // Reset the module entry — remove startedAt, completedAt, error; set status to pending
    const modules = (manifest.modules ?? {}) as Record<string, Record<string, unknown>>;
    const mod = modules[phaseDef.id];
    if (mod) {
      delete mod.startedAt;
      delete mod.completedAt;
      delete mod.error;
      mod.status = "pending";
    } else {
      modules[phaseDef.id] = { status: "pending" };
    }
    manifest.modules = modules;

    // Write back to manifest.json
    try {
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    } catch (err) {
      errorResponse(res, 500, `Failed to write manifest: ${err instanceof Error ? err.message : String(err)}`);
      return true;
    }

    // Broadcast reset state
    broadcastPhaseUpdate(broadcast, {
      phase,
      phaseId: phaseDef.id,
      status: "pending",
    });

    jsonResponse(res, 200, {
      phase,
      phaseId: phaseDef.id,
      phaseName: phaseDef.name,
      status: "pending",
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

  // GET /api/sv/phases — ordered analysis phase status from manifest modules
  if (path === "phases") {
    // Run the shared concurrency check FIRST — it auto-clears stale PID locks
    // in the manifest, so subsequent reads see accurate status.
    const lockCheck = isAnalysisRunning(ctx.projectDir);
    const anyRunning = activePhaseRun !== null || lockCheck.running;

    const manifest = loadDataFile(ctx, DATA_FILES.manifest) as Record<string, unknown> | null;
    if (!manifest) {
      // Return all phases as pending with anyRunning false when no manifest exists.
      // This lets the UI render the phase panel in empty state.
      const phases = PHASE_DEFINITIONS.map((def) => ({
        id: def.id,
        phase: def.phase,
        name: def.name,
        description: def.description,
        status: "pending" as const,
        startedAt: null,
        completedAt: null,
        error: null,
      }));
      jsonResponse(res, 200, { phases, anyRunning: false });
      return true;
    }
    const modules = (manifest.modules ?? {}) as Record<string, Record<string, unknown>>;

    const phases = PHASE_DEFINITIONS.map((def) => {
      const mod = modules[def.id];
      return {
        id: def.id,
        phase: def.phase,
        name: def.name,
        description: def.description,
        status: mod?.status ?? "pending",
        startedAt: mod?.startedAt ?? null,
        completedAt: mod?.completedAt ?? null,
        error: mod?.error ?? null,
      };
    });
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
