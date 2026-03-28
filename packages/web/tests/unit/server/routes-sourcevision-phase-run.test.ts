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

let _handles: MockHandle[] = [];
let _spawnCalls: { cmd: string; args: string[] }[] = [];

vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@n-dx/llm-client")>();
  return {
    ...original,
    spawnManaged: vi.fn((_cmd: string, _args: string[]) => {
      _spawnCalls.push({ cmd: _cmd, args: _args });
      const handle = createMockHandle(99999);
      _handles.push(handle);
      return handle;
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

describe("POST /api/sv/phases/:n/run (grouped phases)", () => {
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
    _handles = [];
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
    // Resolve all mock handles to prevent dangling promises
    for (const h of _handles) {
      h.exit();
    }
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("POST /api/sv/phases/1/run spawns inventory first and returns 202", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "POST",
    });
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.group).toBe(1);
    expect(data.groupName).toBe("Scan");
    expect(data.status).toBe("started");
    expect(data.startedAt).toBeTruthy();
    expect(data.modules).toEqual(["inventory", "imports", "configsurface"]);

    // First spawn should be inventory (--phase=1)
    expect(_spawnCalls).toHaveLength(1);
    expect(_spawnCalls[0].args).toContain("analyze");
    expect(_spawnCalls[0].args).toContain("--phase=1");
  });

  it("POST /api/sv/phases/1/run runs modules sequentially: inventory → imports → configsurface", async () => {
    await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "POST",
    });

    // First module: inventory (--phase=1)
    expect(_spawnCalls).toHaveLength(1);
    expect(_spawnCalls[0].args).toContain("--phase=1");

    // Complete inventory → should auto-spawn imports (--phase=2)
    _handles[0].exit({ exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(_spawnCalls).toHaveLength(2);
    expect(_spawnCalls[1].args).toContain("--phase=2");

    // Complete imports → should auto-spawn configsurface (--phase=7)
    _handles[1].exit({ exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(_spawnCalls).toHaveLength(3);
    expect(_spawnCalls[2].args).toContain("--phase=7");

    // Complete configsurface → group should be done
    _handles[2].exit({ exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should broadcast "complete" for the group
    const completeMsg = bc.messages.find(
      (m) => m.type === "sv:phase-update" && m.status === "complete",
    );
    expect(completeMsg).toBeDefined();
    expect(completeMsg!.group).toBe(1);
    expect(completeMsg!.finishedAt).toBeTruthy();
  });

  it("POST /api/sv/phases/2/run spawns classifications + components in sequence", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/2/run`, {
      method: "POST",
    });
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.group).toBe(2);
    expect(data.groupName).toBe("Classify");
    expect(data.modules).toEqual(["classifications", "components"]);

    // First spawn: classifications (--phase=3)
    expect(_spawnCalls).toHaveLength(1);
    expect(_spawnCalls[0].args).toContain("--phase=3");

    // Complete classifications → should spawn components (--phase=5)
    _handles[0].exit({ exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(_spawnCalls).toHaveLength(2);
    expect(_spawnCalls[1].args).toContain("--phase=5");
  });

  it("POST /api/sv/phases/3/run spawns zones + callgraph in sequence", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/3/run`, {
      method: "POST",
    });
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.group).toBe(3);
    expect(data.groupName).toBe("Architecture");

    // First spawn: zones (--phase=4)
    expect(_spawnCalls).toHaveLength(1);
    expect(_spawnCalls[0].args).toContain("--phase=4");

    // Complete zones → should spawn callgraph (--phase=6)
    _handles[0].exit({ exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(_spawnCalls).toHaveLength(2);
    expect(_spawnCalls[1].args).toContain("--phase=6");
  });

  it("POST /api/sv/phases/4/run spawns zone enrichment with --full flag", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/4/run`, {
      method: "POST",
    });
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.group).toBe(4);
    expect(data.groupName).toBe("Deep Analysis");

    // Should spawn with --phase=4 and --full
    expect(_spawnCalls).toHaveLength(1);
    expect(_spawnCalls[0].args).toContain("--phase=4");
    expect(_spawnCalls[0].args).toContain("--full");
  });

  it("returns 409 if a phase group is already running", async () => {
    // Start group 1
    const res1 = await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "POST",
    });
    expect(res1.status).toBe(202);

    // Attempt group 2 — should be blocked
    const res2 = await fetch(`http://localhost:${port}/api/sv/phases/2/run`, {
      method: "POST",
    });
    expect(res2.status).toBe(409);

    const data = await res2.json();
    expect(data.error).toContain("already running");
    expect(data.activePhase).toBe(1);
  });

  it("returns 400 for invalid phase number 0", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/0/run`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid phase number");
  });

  it("returns 400 for phase number > 4", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/5/run`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid phase number");
  });

  it("broadcasts sv:phase-update on group start", async () => {
    await fetch(`http://localhost:${port}/api/sv/phases/2/run`, {
      method: "POST",
    });

    const runningMsg = bc.messages.find(
      (m) => m.type === "sv:phase-update" && m.status === "running",
    );
    expect(runningMsg).toBeDefined();
    expect(runningMsg!.group).toBe(2);
    expect(runningMsg!.module).toBe("classifications");
    expect(runningMsg!.timestamp).toBeTruthy();
  });

  it("broadcasts sv:phase-update with 'error' when module fails and stops group", async () => {
    await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "POST",
    });

    // Fail the first module
    _handles[0].exit({ exitCode: 1, stderr: "Inventory failed" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const errorMsg = bc.messages.find(
      (m) => m.type === "sv:phase-update" && m.status === "error",
    );
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.group).toBe(1);
    expect(errorMsg!.error).toContain("Inventory failed");

    // No further modules should have been spawned
    expect(_spawnCalls).toHaveLength(1);
  });

  it("clears singleton guard after group completes", async () => {
    await fetch(`http://localhost:${port}/api/sv/phases/3/run`, {
      method: "POST",
    });

    // Complete both modules in group 3
    _handles[0].exit({ exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    _handles[1].exit({ exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Second group run should succeed
    const res2 = await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "POST",
    });
    expect(res2.status).toBe(202);
  });

  it("GET requests to phases/:n/run are not handled", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "GET",
    });
    expect(res.status).toBe(404);
  });
});

describe("shutdownPhaseRun", () => {
  it("returns false when no phase is running", () => {
    expect(shutdownPhaseRun()).toBe(false);
  });
});
