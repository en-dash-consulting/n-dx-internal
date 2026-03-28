/**
 * Phase prerequisite enforcement tests.
 *
 * Verifies that phases 2–4 cannot be triggered unless all prior phases
 * are complete. The server should return 400 with a clear error message
 * and the code "PREREQUISITE_NOT_MET".
 *
 * Also verifies that GET /api/sv/phases returns prerequisiteMet and
 * prerequisiteHint fields for UI lock state.
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

let _handles: MockHandle[] = [];

vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@n-dx/llm-client")>();
  return {
    ...original,
    spawnManaged: vi.fn(() => {
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

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a manifest with specific module statuses. */
function makeManifest(modules: Record<string, { status: string; completedAt?: string }>) {
  return {
    schemaVersion: "1.0.0",
    toolVersion: "1.0.0",
    analyzedAt: new Date().toISOString(),
    targetPath: "/tmp/test",
    modules,
  };
}

/** Module statuses for a fully complete Phase 1 (Scan). */
const PHASE1_COMPLETE = {
  inventory: { status: "complete", completedAt: new Date().toISOString() },
  imports: { status: "complete", completedAt: new Date().toISOString() },
  configsurface: { status: "complete", completedAt: new Date().toISOString() },
};

/** Module statuses for a fully complete Phase 2 (Classify). */
const PHASE2_COMPLETE = {
  classifications: { status: "complete", completedAt: new Date().toISOString() },
  components: { status: "complete", completedAt: new Date().toISOString() },
};

/** Module statuses for a fully complete Phase 3 (Architecture). */
const PHASE3_COMPLETE = {
  zones: { status: "complete", completedAt: new Date().toISOString() },
  callgraph: { status: "complete", completedAt: new Date().toISOString() },
};

// ── Tests: POST prerequisite enforcement ─────────────────────────────────

describe("phase prerequisite enforcement (POST /api/sv/phases/:n/run)", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    _handles = [];

    tmpDir = await mkdtemp(join(tmpdir(), "sv-prereq-"));
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
    for (const h of _handles) h.exit();
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("Phase 1 is always runnable (no prerequisites)", async () => {
    // Empty manifest — no modules complete
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(makeManifest({})));

    const res = await fetch(`http://localhost:${port}/api/sv/phases/1/run`, {
      method: "POST",
    });
    expect(res.status).toBe(202);
  });

  it("Phase 2 returns 400 when Phase 1 is not complete", async () => {
    // Phase 1 modules only partially complete
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify(makeManifest({
        inventory: { status: "complete", completedAt: new Date().toISOString() },
        imports: { status: "pending" },
      })),
    );

    const res = await fetch(`http://localhost:${port}/api/sv/phases/2/run`, {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.code).toBe("PREREQUISITE_NOT_MET");
    expect(data.phase).toBe(2);
    expect(data.error).toContain("Phase 1");
    expect(data.error).toContain("Scan");
    expect(data.error).toContain("complete first");
  });

  it("Phase 2 returns 202 when Phase 1 is complete", async () => {
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify(makeManifest(PHASE1_COMPLETE)),
    );

    const res = await fetch(`http://localhost:${port}/api/sv/phases/2/run`, {
      method: "POST",
    });
    expect(res.status).toBe(202);
  });

  it("Phase 3 returns 400 when Phase 2 is not complete", async () => {
    // Phase 1 complete but Phase 2 not
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify(makeManifest(PHASE1_COMPLETE)),
    );

    const res = await fetch(`http://localhost:${port}/api/sv/phases/3/run`, {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.code).toBe("PREREQUISITE_NOT_MET");
    expect(data.phase).toBe(3);
    expect(data.error).toContain("Phase 2");
    expect(data.error).toContain("Classify");
  });

  it("Phase 3 returns 400 when Phase 1 is not complete (even if Phase 2 is)", async () => {
    // Phase 2 complete but Phase 1 not
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify(makeManifest(PHASE2_COMPLETE)),
    );

    const res = await fetch(`http://localhost:${port}/api/sv/phases/3/run`, {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.code).toBe("PREREQUISITE_NOT_MET");
    expect(data.error).toContain("Phase 1");
  });

  it("Phase 3 returns 202 when Phases 1 and 2 are complete", async () => {
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify(makeManifest({ ...PHASE1_COMPLETE, ...PHASE2_COMPLETE })),
    );

    const res = await fetch(`http://localhost:${port}/api/sv/phases/3/run`, {
      method: "POST",
    });
    expect(res.status).toBe(202);
  });

  it("Phase 4 returns 400 when Phase 3 is not complete", async () => {
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify(makeManifest({ ...PHASE1_COMPLETE, ...PHASE2_COMPLETE })),
    );

    const res = await fetch(`http://localhost:${port}/api/sv/phases/4/run`, {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.code).toBe("PREREQUISITE_NOT_MET");
    expect(data.phase).toBe(4);
    expect(data.error).toContain("Phase 3");
    expect(data.error).toContain("Architecture");
  });

  it("Phase 4 returns 202 when Phases 1, 2, and 3 are complete", async () => {
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify(makeManifest({
        ...PHASE1_COMPLETE,
        ...PHASE2_COMPLETE,
        ...PHASE3_COMPLETE,
      })),
    );

    const res = await fetch(`http://localhost:${port}/api/sv/phases/4/run`, {
      method: "POST",
    });
    expect(res.status).toBe(202);
  });

  it("Phase 2 returns 400 with no manifest (empty state)", async () => {
    // No manifest file at all — Phase 1 cannot be complete
    const res = await fetch(`http://localhost:${port}/api/sv/phases/2/run`, {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.code).toBe("PREREQUISITE_NOT_MET");
  });
});

// ── Tests: GET /api/sv/phases prerequisite fields ────────────────────────

describe("GET /api/sv/phases prerequisite fields", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    _handles = [];

    tmpDir = await mkdtemp(join(tmpdir(), "sv-prereq-get-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    shutdownPhaseRun();
    for (const h of _handles) h.exit();
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("Phase 1 always has prerequisiteMet: true", async () => {
    // No manifest — all phases pending
    const res = await fetch(`http://localhost:${port}/api/sv/phases`);
    const data = await res.json();

    const phase1 = data.phases.find((p: { group: number }) => p.group === 1);
    expect(phase1.prerequisiteMet).toBe(true);
    expect(phase1.prerequisiteHint).toBeNull();
  });

  it("Phases 2-4 have prerequisiteMet: false when no modules are complete", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases`);
    const data = await res.json();

    for (const group of [2, 3, 4]) {
      const phase = data.phases.find((p: { group: number }) => p.group === group);
      expect(phase.prerequisiteMet).toBe(false);
      expect(phase.prerequisiteHint).toContain("must complete first");
    }
  });

  it("Phase 2 becomes unlocked when Phase 1 is complete", async () => {
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify(makeManifest(PHASE1_COMPLETE)),
    );

    const res = await fetch(`http://localhost:${port}/api/sv/phases`);
    const data = await res.json();

    const phase2 = data.phases.find((p: { group: number }) => p.group === 2);
    expect(phase2.prerequisiteMet).toBe(true);
    expect(phase2.prerequisiteHint).toBeNull();

    // Phase 3 should still be locked (needs Phase 2)
    const phase3 = data.phases.find((p: { group: number }) => p.group === 3);
    expect(phase3.prerequisiteMet).toBe(false);
    expect(phase3.prerequisiteHint).toContain("Phase 2");
  });

  it("prerequisiteHint identifies the first incomplete prerequisite", async () => {
    // Phase 1 complete, Phase 2 not complete
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify(makeManifest(PHASE1_COMPLETE)),
    );

    const res = await fetch(`http://localhost:${port}/api/sv/phases`);
    const data = await res.json();

    // Phase 4 should cite Phase 2 (the first incomplete), not Phase 3
    const phase4 = data.phases.find((p: { group: number }) => p.group === 4);
    expect(phase4.prerequisiteMet).toBe(false);
    expect(phase4.prerequisiteHint).toContain("Phase 2");
    expect(phase4.prerequisiteHint).toContain("Classify");
  });

  it("all phases unlocked when all prerequisites complete", async () => {
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify(makeManifest({
        ...PHASE1_COMPLETE,
        ...PHASE2_COMPLETE,
        ...PHASE3_COMPLETE,
      })),
    );

    const res = await fetch(`http://localhost:${port}/api/sv/phases`);
    const data = await res.json();

    for (const phase of data.phases) {
      expect(phase.prerequisiteMet).toBe(true);
      expect(phase.prerequisiteHint).toBeNull();
    }
  });
});
