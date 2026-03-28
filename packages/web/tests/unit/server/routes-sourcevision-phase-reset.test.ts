import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";

// ── Mock setup ───────────────────────────────────────────────────────────

// spawnManaged is unused by reset but required by the module
vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@n-dx/llm-client")>();
  return {
    ...original,
    spawnManaged: vi.fn(() => {
      throw new Error("spawnManaged should not be called by reset endpoint");
    }),
  };
});

// Import after mock setup
const { handleSourcevisionRoute } = await import(
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

describe("POST /api/sv/phases/:phase/reset", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  let bc: ReturnType<typeof createBroadcastCapture>;

  const manifestWithCompletedPhase = {
    schema: "sourcevision/v1",
    project: "test-project",
    timestamp: "2026-01-01T00:00:00.000Z",
    version: "0.1.0",
    modules: {
      inventory: {
        status: "complete",
        startedAt: "2026-01-01T00:00:01.000Z",
        completedAt: "2026-01-01T00:00:02.000Z",
      },
      imports: {
        status: "error",
        startedAt: "2026-01-01T00:00:03.000Z",
        completedAt: "2026-01-01T00:00:04.000Z",
        error: "Something went wrong",
      },
    },
  };

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-phase-reset-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify(manifestWithCompletedPhase),
    );

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    bc = createBroadcastCapture();

    const started = await startTestServer(ctx, bc.broadcast);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("resets a completed phase back to pending and returns 200", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/1/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.phase).toBe(1);
    expect(data.phaseId).toBe("inventory");
    expect(data.phaseName).toBe("Inventory");
    expect(data.status).toBe("pending");
  });

  it("clears startedAt, completedAt, and error from manifest.json", async () => {
    await fetch(`http://localhost:${port}/api/sv/phases/2/reset`, {
      method: "POST",
    });

    // Read manifest back from disk
    const raw = await readFile(join(svDir, "manifest.json"), "utf-8");
    const manifest = JSON.parse(raw);
    const mod = manifest.modules.imports;

    expect(mod.status).toBe("pending");
    expect(mod.startedAt).toBeUndefined();
    expect(mod.completedAt).toBeUndefined();
    expect(mod.error).toBeUndefined();
  });

  it("returns 400 for invalid phase number 0", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/0/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("Invalid phase number");
  });

  it("returns 400 for phase number > 7", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/8/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("Invalid phase number");
  });

  it("returns 404 when no manifest exists", async () => {
    // Remove the manifest
    const { rm: rmFs } = await import("node:fs/promises");
    await rmFs(join(svDir, "manifest.json"));

    const res = await fetch(`http://localhost:${port}/api/sv/phases/1/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toContain("No manifest data");
  });

  it("broadcasts sv:phase-update with pending status after reset", async () => {
    await fetch(`http://localhost:${port}/api/sv/phases/1/reset`, {
      method: "POST",
    });

    const resetMsg = bc.messages.find(
      (m) => m.type === "sv:phase-update" && m.status === "pending",
    );
    expect(resetMsg).toBeDefined();
    expect(resetMsg!.phase).toBe(1);
    expect(resetMsg!.phaseId).toBe("inventory");
    expect(resetMsg!.timestamp).toBeTruthy();
  });

  it("handles resetting a phase that has no module entry yet", async () => {
    // Phase 5 (components) has no entry in the test manifest
    const res = await fetch(`http://localhost:${port}/api/sv/phases/5/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.phase).toBe(5);
    expect(data.phaseId).toBe("components");
    expect(data.status).toBe("pending");

    // Verify it was written to manifest
    const raw = await readFile(join(svDir, "manifest.json"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.modules.components).toEqual({ status: "pending" });
  });

  it("preserves other module entries when resetting one phase", async () => {
    // Reset phase 1 (inventory), verify phase 2 (imports) is untouched
    await fetch(`http://localhost:${port}/api/sv/phases/1/reset`, {
      method: "POST",
    });

    const raw = await readFile(join(svDir, "manifest.json"), "utf-8");
    const manifest = JSON.parse(raw);

    // Phase 1 should be reset
    expect(manifest.modules.inventory.status).toBe("pending");
    expect(manifest.modules.inventory.startedAt).toBeUndefined();

    // Phase 2 should be unchanged
    expect(manifest.modules.imports.status).toBe("error");
    expect(manifest.modules.imports.startedAt).toBe("2026-01-01T00:00:03.000Z");
    expect(manifest.modules.imports.error).toBe("Something went wrong");
  });

  it("GET requests to phases/:phase/reset are not handled", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/1/reset`, {
      method: "GET",
    });
    // Should fall through — not handled by the route
    expect(res.status).toBe(404);
  });
});
