import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import type { SpawnToolResult, ManagedChild } from "@n-dx/llm-client";

// ── Mock setup ───────────────────────────────────────────────────────────

interface MockHandle extends ManagedChild {
  /** Resolve the done promise (simulate process exit). */
  exit(result?: Partial<SpawnToolResult>): void;
  /** Track kill signals received. */
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
let _spawnCalls: { cmd: string; args: string[] }[] = [];

vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@n-dx/llm-client")>();
  return {
    ...original,
    spawnManaged: vi.fn((_cmd: string, _args: string[]) => {
      _spawnCalls.push({ cmd: _cmd, args: _args });
      _latestHandle = createMockHandle(99999);
      return _latestHandle;
    }),
  };
});

// Import after mock setup
const { handleSourcevisionRoute, shutdownPhaseRun } = await import(
  "../../../src/server/routes-sourcevision.js"
);

// ── Broadcast capture ────────────────────────────────────────────────────

type BroadcastMessage = Record<string, unknown>;

function createBroadcastCapture(): {
  broadcast: (data: unknown) => void;
  messages: BroadcastMessage[];
} {
  const messages: BroadcastMessage[] = [];
  return {
    broadcast: (data: unknown) => messages.push(data as BroadcastMessage),
    messages,
  };
}

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

describe("POST /api/sv/phases/:phase/run", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  let bc: ReturnType<typeof createBroadcastCapture>;

  const manifestData = {
    schema: "sourcevision/v1",
    project: "test-project",
    timestamp: "2026-01-01T00:00:00.000Z",
    version: "0.1.0",
  };

  beforeEach(async () => {
    _latestHandle = null;
    _spawnCalls = [];

    tmpDir = await mkdtemp(join(tmpdir(), "sv-phase-run-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(manifestData));

    // Create fallback binary path so existsSync resolves
    const svCliDir = join(tmpDir, "packages", "sourcevision", "dist", "cli");
    await mkdir(svCliDir, { recursive: true });
    await writeFile(join(svCliDir, "index.js"), "");

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    bc = createBroadcastCapture();

    const started = await startTestServer(ctx, bc.broadcast);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    // Clean up any active phase run
    shutdownPhaseRun();
    // Resolve mock handle to prevent dangling promises
    if (_latestHandle) {
      _latestHandle.exit();
    }
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("spawns sourcevision analyze --phase=N and returns 202", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "POST",
    });
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.phase).toBe(1);
    expect(data.phaseId).toBe("inventory");
    expect(data.phaseName).toBe("Inventory");
    expect(data.status).toBe("started");
    expect(data.startedAt).toBeTruthy();

    // Verify spawn was called with correct args
    expect(_spawnCalls).toHaveLength(1);
    expect(_spawnCalls[0].args).toContain("analyze");
    expect(_spawnCalls[0].args).toContain("--phase=1");
    expect(_spawnCalls[0].args).toContain(tmpDir);
  });

  it("returns 409 if a phase is already running", async () => {
    // Start first phase
    const res1 = await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "POST",
    });
    expect(res1.status).toBe(202);

    // Attempt second phase — should be blocked
    const res2 = await fetch(`http://localhost:${port}/api/sv/phases/2/run`, {
      method: "POST",
    });
    expect(res2.status).toBe(409);

    const data = await res2.json();
    expect(data.error).toContain("already running");
    expect(data.activePhase).toBe(1);
    expect(data.activePhaseId).toBe("inventory");
  });

  it("returns 400 for invalid phase number", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/0/run`, {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("Invalid phase number");
  });

  it("returns 400 for phase number > 7", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/8/run`, {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("Invalid phase number");
  });

  it("broadcasts sv:phase-update on start", async () => {
    await fetch(`http://localhost:${port}/api/sv/phases/3/run`, {
      method: "POST",
    });

    // Should have broadcast a "running" status
    const runningMsg = bc.messages.find(
      (m) => m.type === "sv:phase-update" && m.status === "running",
    );
    expect(runningMsg).toBeDefined();
    expect(runningMsg!.phase).toBe(3);
    expect(runningMsg!.phaseId).toBe("classifications");
    expect(runningMsg!.timestamp).toBeTruthy();
  });

  it("broadcasts sv:phase-update with 'complete' on successful exit", async () => {
    await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "POST",
    });

    // Simulate successful process exit
    _latestHandle!.exit({ exitCode: 0 });

    // Wait for the async .then() to execute
    await new Promise((resolve) => setTimeout(resolve, 50));

    const completeMsg = bc.messages.find(
      (m) => m.type === "sv:phase-update" && m.status === "complete",
    );
    expect(completeMsg).toBeDefined();
    expect(completeMsg!.phase).toBe(1);
    expect(completeMsg!.phaseId).toBe("inventory");
    expect(completeMsg!.finishedAt).toBeTruthy();
  });

  it("broadcasts sv:phase-update with 'error' on failed exit", async () => {
    await fetch(`http://localhost:${port}/api/sv/phases/2/run`, {
      method: "POST",
    });

    // Simulate failed process exit
    _latestHandle!.exit({ exitCode: 1, stderr: "Phase 2 failed" });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const errorMsg = bc.messages.find(
      (m) => m.type === "sv:phase-update" && m.status === "error",
    );
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.phase).toBe(2);
    expect(errorMsg!.exitCode).toBe(1);
    expect(errorMsg!.error).toContain("Phase 2 failed");
  });

  it("clears singleton guard after process completes", async () => {
    await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "POST",
    });

    // Complete the first run
    _latestHandle!.exit({ exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Second run should succeed (singleton cleared)
    const res2 = await fetch(`http://localhost:${port}/api/sv/phases/2/run`, {
      method: "POST",
    });
    expect(res2.status).toBe(202);
    const data = await res2.json();
    expect(data.phase).toBe(2);
    expect(data.phaseId).toBe("imports");
  });

  it("supports all 7 phases", async () => {
    const phaseIds = [
      "inventory", "imports", "classifications", "zones",
      "components", "callgraph", "configsurface",
    ];

    for (let phase = 1; phase <= 7; phase++) {
      _latestHandle = null;
      _spawnCalls = [];

      const res = await fetch(`http://localhost:${port}/api/sv/phases/${phase}/run`, {
        method: "POST",
      });
      expect(res.status).toBe(202);

      const data = await res.json();
      expect(data.phase).toBe(phase);
      expect(data.phaseId).toBe(phaseIds[phase - 1]);

      // Complete the run so next iteration can start
      _latestHandle!.exit({ exitCode: 0 });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });

  it("GET requests to phases/:phase/run are not handled", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "GET",
    });
    // Should fall through — not handled by the route
    expect(res.status).toBe(404);
  });
});

describe("shutdownPhaseRun", () => {
  it("returns false when no phase is running", () => {
    expect(shutdownPhaseRun()).toBe(false);
  });
});
