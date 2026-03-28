/**
 * Concurrency guard tests for sourcevision routes.
 *
 * Tests the cross-process concurrency guard that prevents parallel
 * sourcevision analyze runs across all entry points (UI/CLI/MCP).
 *
 * Covers:
 * - POST /api/sv/phases/:phase/run returns 409 when external process running
 * - GET /api/sv/phases returns { phases, anyRunning } envelope
 * - GET /api/sv/phases returns anyRunning:true when external process running
 * - Stale PID locks are auto-cleared via isAnalysisRunning()
 * - GET /api/sv/phases returns pending phases with anyRunning:false on empty state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import type { SpawnToolResult, ManagedChild } from "@n-dx/llm-client";

// ── Mock setup ───────────────────────────────────────────────────────────

interface MockHandle extends ManagedChild {
  exit(result?: Partial<SpawnToolResult>): void;
  killCalls: string[];
}

function createMockHandle(pid = 12345): MockHandle {
  let resolveDone: (value: SpawnToolResult) => void;
  const killCalls: string[] = [];
  const handle: MockHandle = {
    done: new Promise<SpawnToolResult>((resolve) => {
      resolveDone = resolve;
    }),
    kill(signal?: NodeJS.Signals): boolean {
      killCalls.push(signal ?? "SIGTERM");
      return true;
    },
    get pid() {
      return pid;
    },
    exit(result: Partial<SpawnToolResult> = {}) {
      resolveDone({ exitCode: 0, stdout: "", stderr: "", ...result });
    },
    killCalls,
  };
  return handle;
}

let _latestHandle: MockHandle | null = null;

vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@n-dx/llm-client")>();
  return {
    ...original,
    spawnManaged: vi.fn(() => {
      _latestHandle = createMockHandle(99999);
      return _latestHandle;
    }),
  };
});

// Import after mock setup
const { handleSourcevisionRoute, shutdownPhaseRun } = await import(
  "../../../src/server/routes-sourcevision.js"
);

// ── Test server ──────────────────────────────────────────────────────────

function startTestServer(
  ctx: ServerContext,
  broadcast?: (data: unknown) => void,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (handleSourcevisionRoute(req, res, ctx, broadcast)) return;
      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("cross-process concurrency guard", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    _latestHandle = null;

    tmpDir = await mkdtemp(join(tmpdir(), "sv-concurrency-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    // Create fallback binary path so existsSync resolves
    const svCliDir = join(tmpDir, "packages", "sourcevision", "dist", "cli");
    await mkdir(svCliDir, { recursive: true });
    await writeFile(join(svCliDir, "index.js"), "");

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    shutdownPhaseRun();
    if (_latestHandle) _latestHandle.exit();
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("POST /api/sv/phases/:phase/run returns 409 when manifest shows running module", async () => {
    // Write manifest with a module that has status "running" and our own PID
    // (so the PID check considers it alive)
    const manifest = {
      schemaVersion: "1.0.0",
      toolVersion: "1.0.0",
      analyzedAt: new Date().toISOString(),
      targetPath: tmpDir,
      modules: {
        inventory: {
          status: "running",
          startedAt: new Date().toISOString(),
          pid: process.pid, // Current process PID — will be alive
        },
      },
    };
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(manifest));

    const res = await fetch(`http://localhost:${port}/api/sv/phases/2/run`, {
      method: "POST",
    });
    expect(res.status).toBe(409);

    const data = await res.json();
    expect(data.error).toContain("already running");
    expect(data.source).toBe("manifest");
    expect(data.runningModules).toContain("inventory");
  });

  it("POST /api/sv/phases/:phase/run auto-clears stale PID and allows execution", async () => {
    // Write manifest with a "running" module that has a dead PID
    const manifest = {
      schemaVersion: "1.0.0",
      toolVersion: "1.0.0",
      analyzedAt: new Date().toISOString(),
      targetPath: tmpDir,
      modules: {
        inventory: {
          status: "running",
          startedAt: new Date().toISOString(),
          pid: 999999, // Very unlikely to be alive
        },
      },
    };
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(manifest));

    // The stale lock should be auto-cleared, allowing the run
    const res = await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "POST",
    });
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.status).toBe("started");
  });
});

describe("GET /api/sv/phases response envelope", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    _latestHandle = null;

    tmpDir = await mkdtemp(join(tmpdir(), "sv-phases-envelope-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    // Create fallback binary path
    const svCliDir = join(tmpDir, "packages", "sourcevision", "dist", "cli");
    await mkdir(svCliDir, { recursive: true });
    await writeFile(join(svCliDir, "index.js"), "");

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    shutdownPhaseRun();
    if (_latestHandle) _latestHandle.exit();
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns { phases, anyRunning } object envelope", async () => {
    const manifest = {
      schemaVersion: "1.0.0",
      toolVersion: "1.0.0",
      analyzedAt: new Date().toISOString(),
      targetPath: tmpDir,
      modules: {
        inventory: { status: "complete", completedAt: new Date().toISOString() },
      },
    };
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(manifest));

    const res = await fetch(`http://localhost:${port}/api/sv/phases`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data).toHaveProperty("phases");
    expect(data).toHaveProperty("anyRunning");
    expect(Array.isArray(data.phases)).toBe(true);
    expect(data.phases).toHaveLength(7);
    expect(data.anyRunning).toBe(false);
  });

  it("anyRunning is true when manifest shows running module with live PID", async () => {
    const manifest = {
      schemaVersion: "1.0.0",
      toolVersion: "1.0.0",
      analyzedAt: new Date().toISOString(),
      targetPath: tmpDir,
      modules: {
        imports: {
          status: "running",
          startedAt: new Date().toISOString(),
          pid: process.pid, // Current process — alive
        },
      },
    };
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(manifest));

    const res = await fetch(`http://localhost:${port}/api/sv/phases`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.anyRunning).toBe(true);
    // The imports phase should still show as running
    const importsPhase = data.phases.find((p: { id: string }) => p.id === "imports");
    expect(importsPhase.status).toBe("running");
  });

  it("anyRunning is false after stale PID is auto-cleared", async () => {
    const manifest = {
      schemaVersion: "1.0.0",
      toolVersion: "1.0.0",
      analyzedAt: new Date().toISOString(),
      targetPath: tmpDir,
      modules: {
        zones: {
          status: "running",
          startedAt: new Date().toISOString(),
          pid: 999999, // Dead PID
        },
      },
    };
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(manifest));

    const res = await fetch(`http://localhost:${port}/api/sv/phases`);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Stale lock should have been auto-cleared
    expect(data.anyRunning).toBe(false);
    // The zones phase should now show as error (stale cleared)
    const zonesPhase = data.phases.find((p: { id: string }) => p.id === "zones");
    expect(zonesPhase.status).toBe("error");
  });

  it("returns pending phases with anyRunning:false when no manifest exists", async () => {
    // Use a dir with no manifest
    const emptyDir = await mkdtemp(join(tmpdir(), "sv-phases-empty-"));
    const emptySvDir = join(emptyDir, ".sourcevision");
    await mkdir(emptySvDir, { recursive: true });
    const emptyCtx: ServerContext = {
      projectDir: emptyDir,
      svDir: emptySvDir,
      rexDir,
      dev: false,
    };

    const emptyStarted = await startTestServer(emptyCtx);
    try {
      const res = await fetch(`http://localhost:${emptyStarted.port}/api/sv/phases`);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.anyRunning).toBe(false);
      expect(data.phases).toHaveLength(7);
      for (const phase of data.phases) {
        expect(phase.status).toBe("pending");
      }
    } finally {
      emptyStarted.server.close();
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("anyRunning is true when in-process phase is active (via activePhaseRun)", async () => {
    // Write a manifest with no running modules
    const manifest = {
      schemaVersion: "1.0.0",
      toolVersion: "1.0.0",
      analyzedAt: new Date().toISOString(),
      targetPath: tmpDir,
      modules: {},
    };
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(manifest));

    // Start a phase via POST — this sets activePhaseRun
    const runRes = await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "POST",
    });
    expect(runRes.status).toBe(202);

    // Now GET /api/sv/phases should show anyRunning:true
    const res = await fetch(`http://localhost:${port}/api/sv/phases`);
    const data = await res.json();
    expect(data.anyRunning).toBe(true);
  });
});
