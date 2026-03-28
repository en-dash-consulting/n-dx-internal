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

describe("POST /api/sv/phases/:n/reset (grouped phases)", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  let bc: ReturnType<typeof createBroadcastCapture>;

  const manifestWithCompletedPhases = {
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
        status: "complete",
        startedAt: "2026-01-01T00:00:02.000Z",
        completedAt: "2026-01-01T00:00:03.000Z",
      },
      configsurface: {
        status: "error",
        startedAt: "2026-01-01T00:00:03.000Z",
        completedAt: "2026-01-01T00:00:04.000Z",
        error: "Config surface failed",
      },
      classifications: {
        status: "complete",
        startedAt: "2026-01-01T00:00:05.000Z",
        completedAt: "2026-01-01T00:00:06.000Z",
      },
      components: {
        status: "complete",
        startedAt: "2026-01-01T00:00:06.000Z",
        completedAt: "2026-01-01T00:00:07.000Z",
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
      JSON.stringify(manifestWithCompletedPhases),
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

  it("resets all modules in group 1 (Scan) back to pending", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/1/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.group).toBe(1);
    expect(data.groupName).toBe("Scan");
    expect(data.status).toBe("pending");
    expect(data.modules).toEqual(["inventory", "imports", "configsurface"]);

    // Read manifest back from disk — all 3 modules should be reset
    const raw = await readFile(join(svDir, "manifest.json"), "utf-8");
    const manifest = JSON.parse(raw);

    for (const moduleId of ["inventory", "imports", "configsurface"]) {
      const mod = manifest.modules[moduleId];
      expect(mod.status).toBe("pending");
      expect(mod.startedAt).toBeUndefined();
      expect(mod.completedAt).toBeUndefined();
      expect(mod.error).toBeUndefined();
    }
  });

  it("resets all modules in group 2 (Classify) back to pending", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/2/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.group).toBe(2);
    expect(data.groupName).toBe("Classify");
    expect(data.modules).toEqual(["classifications", "components"]);

    const raw = await readFile(join(svDir, "manifest.json"), "utf-8");
    const manifest = JSON.parse(raw);

    expect(manifest.modules.classifications.status).toBe("pending");
    expect(manifest.modules.components.status).toBe("pending");
  });

  it("preserves other group's modules when resetting one group", async () => {
    // Reset group 1 — group 2 modules should be untouched
    await fetch(`http://localhost:${port}/api/sv/phases/1/reset`, {
      method: "POST",
    });

    const raw = await readFile(join(svDir, "manifest.json"), "utf-8");
    const manifest = JSON.parse(raw);

    // Group 1 modules should be reset
    expect(manifest.modules.inventory.status).toBe("pending");

    // Group 2 modules should be unchanged
    expect(manifest.modules.classifications.status).toBe("complete");
    expect(manifest.modules.components.status).toBe("complete");
  });

  it("returns 400 for invalid phase number 0", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/0/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid phase number");
  });

  it("returns 400 for phase number > 4", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/5/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid phase number");
  });

  it("returns 404 when no manifest exists", async () => {
    const { rm: rmFs } = await import("node:fs/promises");
    await rmFs(join(svDir, "manifest.json"));

    const res = await fetch(`http://localhost:${port}/api/sv/phases/1/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("No manifest data");
  });

  it("broadcasts sv:phase-update with pending status after group reset", async () => {
    await fetch(`http://localhost:${port}/api/sv/phases/1/reset`, {
      method: "POST",
    });

    const resetMsg = bc.messages.find(
      (m) => m.type === "sv:phase-update" && m.status === "pending",
    );
    expect(resetMsg).toBeDefined();
    expect(resetMsg!.group).toBe(1);
    expect(resetMsg!.modules).toEqual(["inventory", "imports", "configsurface"]);
    expect(resetMsg!.timestamp).toBeTruthy();
  });

  it("handles resetting a group where modules have no manifest entry yet", async () => {
    // Group 3 (zones, callgraph) has no entries in test manifest
    const res = await fetch(`http://localhost:${port}/api/sv/phases/3/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.group).toBe(3);
    expect(data.modules).toEqual(["zones", "callgraph"]);

    // Verify entries were created in manifest
    const raw = await readFile(join(svDir, "manifest.json"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.modules.zones).toEqual({ status: "pending" });
    expect(manifest.modules.callgraph).toEqual({ status: "pending" });
  });

  it("GET requests to phases/:n/reset are not handled", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/phases/1/reset`, {
      method: "GET",
    });
    expect(res.status).toBe(404);
  });
});
