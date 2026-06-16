import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      if (await handleLlmRoute(req, res, ctx)) return;
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

async function get(port: number) {
  const res = await fetch(`http://localhost:${port}/api/llm/config`);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function put(port: number, changes: Record<string, unknown>) {
  const res = await fetch(`http://localhost:${port}/api/llm/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("LLM Config API routes", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-routes-llm-"));
    ctx = { projectDir: tmpDir } as ServerContext;
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(() => {
    server.close();
    return rm(tmpDir, { recursive: true, force: true });
  });

  describe("GET /api/llm/config", () => {
    it("returns defaults when no config file exists", async () => {
      const { status, body } = await get(port);
      expect(status).toBe(200);
      expect(body.vendor).toBeNull();
      expect(body.responseTimeout).toBeUndefined();
    });

    it("returns responseTimeout when set in .n-dx.json", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ llm: { responseTimeout: 600000 } }),
      );
      const { status, body } = await get(port);
      expect(status).toBe(200);
      expect(body.responseTimeout).toBe(600000);
    });

    it("omits responseTimeout when value is zero or negative", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ llm: { responseTimeout: 0 } }),
      );
      const { status, body } = await get(port);
      expect(status).toBe(200);
      expect(body.responseTimeout).toBeUndefined();
    });
  });

  describe("PUT /api/llm/config — responseTimeout", () => {
    it("writes a positive millisecond value", async () => {
      const { status, body } = await put(port, { "llm.responseTimeout": 900000 });
      expect(status).toBe(200);
      const cfg = (body as { config: { responseTimeout?: number } }).config;
      expect(cfg.responseTimeout).toBe(900000);
    });

    it("clears the field when null is sent", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ llm: { responseTimeout: 600000 } }),
      );
      const { status, body } = await put(port, { "llm.responseTimeout": null });
      expect(status).toBe(200);
      const cfg = (body as { config: { responseTimeout?: number } }).config;
      expect(cfg.responseTimeout).toBeUndefined();
    });

    it("rejects a non-positive number", async () => {
      const { status } = await put(port, { "llm.responseTimeout": 0 });
      expect(status).toBe(400);
    });

    it("rejects a negative number", async () => {
      const { status } = await put(port, { "llm.responseTimeout": -1000 });
      expect(status).toBe(400);
    });

    it("rejects a string value", async () => {
      const { status } = await put(port, { "llm.responseTimeout": "600000" });
      expect(status).toBe(400);
    });

    it("rejects NaN", async () => {
      // JSON.stringify strips NaN to null, so test via a workaround: pass a non-number string that
      // reaches the route as an actual non-finite. We instead test the guard path via type check.
      // Send a boolean to exercise the type-check branch.
      const { status } = await put(port, { "llm.responseTimeout": true });
      expect(status).toBe(400);
    });
  });

  describe("GET + PUT coexistence", () => {
    it("round-trips vendor, autoFailover, and responseTimeout in one PUT", async () => {
      const { status, body } = await put(port, {
        "llm.vendor": "claude",
        "llm.autoFailover": true,
        "llm.responseTimeout": 300000,
      });
      expect(status).toBe(200);
      const cfg = (body as { config: Record<string, unknown> }).config;
      expect(cfg.vendor).toBe("claude");
      expect(cfg.autoFailover).toBe(true);
      expect(cfg.responseTimeout).toBe(300000);
    });
  });
});
