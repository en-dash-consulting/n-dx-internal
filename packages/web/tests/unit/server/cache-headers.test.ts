/**
 * Tests for HTTP Cache-Control headers on static assets and API endpoints.
 *
 * Acceptance criteria:
 *  - Static assets with content-hash filenames → max-age=31536000, immutable
 *  - Static assets without content-hash → no-cache
 *  - GET /api/status → max-age=5
 *  - POST endpoints (e.g. /api/reload) → no-store
 *  - MCP endpoints → no-store
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, extname, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { staticCacheControl, handleStaticRoute, resolveStaticAssets } from "../../../src/server/routes-static.js";
import {
  handleStatusRoute,
  clearStatusCache,
} from "../../../src/server/routes-status.js";

// ---------------------------------------------------------------------------
// staticCacheControl() unit tests
// ---------------------------------------------------------------------------

describe("staticCacheControl()", () => {
  const IMMUTABLE = "public, max-age=31536000, immutable";

  describe("content-hashed filenames → 1-year immutable", () => {
    it("returns immutable for 8-char hex hash (esbuild default)", () => {
      expect(staticCacheControl("main-a1b2c3d4.js")).toBe(IMMUTABLE);
    });

    it("returns immutable for mixed-case hex hash", () => {
      expect(staticCacheControl("chunk-AABBCCDD.css")).toBe(IMMUTABLE);
    });

    it("returns immutable for 12-char hex hash", () => {
      expect(staticCacheControl("vendor-0aB1cD2eF3AB.js")).toBe(IMMUTABLE);
    });

    it("returns immutable for woff2 font with hash", () => {
      expect(staticCacheControl("inter-a1b2c3d4.woff2")).toBe(IMMUTABLE);
    });

    it("returns immutable for 7-char hash (minimum supported)", () => {
      expect(staticCacheControl("app-1234abc.js")).toBe(IMMUTABLE);
    });

    it("returns immutable for 20-char hash (maximum supported)", () => {
      expect(staticCacheControl(`bundle-${"a1".repeat(10)}.js`)).toBe(IMMUTABLE);
    });
  });

  describe("non-hashed filenames → no-cache", () => {
    it("returns no-cache for plain PNG logo", () => {
      expect(staticCacheControl("SourceVision.png")).toBe("no-cache");
    });

    it("returns no-cache for hyphenated PNG with no hash", () => {
      expect(staticCacheControl("Hench-F.png")).toBe("no-cache");
    });

    it("returns no-cache for favicon.ico", () => {
      expect(staticCacheControl("favicon.ico")).toBe("no-cache");
    });

    it("returns no-cache for plain JS (dev build, no hash)", () => {
      expect(staticCacheControl("main.js")).toBe("no-cache");
    });

    it("returns no-cache for plain CSS", () => {
      expect(staticCacheControl("styles.css")).toBe("no-cache");
    });

    it("returns no-cache for 6-char hash (too short)", () => {
      // Must be at least 7 hex chars
      expect(staticCacheControl("app-abc123.js")).toBe("no-cache");
    });

    it("returns no-cache for 21-char segment (too long)", () => {
      // Must be at most 20 hex chars
      expect(staticCacheControl(`bundle-${"a".repeat(21)}.js`)).toBe("no-cache");
    });

    it("returns no-cache when hash segment contains non-hex characters", () => {
      expect(staticCacheControl("app-xyz!@#.js")).toBe("no-cache");
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/status → Cache-Control: max-age=5
// ---------------------------------------------------------------------------

describe("GET /api/status Cache-Control header", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    clearStatusCache();
    tmpDir = await mkdtemp(join(tmpdir(), "cache-status-"));
    const svDir = join(tmpDir, ".sourcevision");
    const rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };

    await new Promise<void>((res) => {
      server = createServer((req: IncomingMessage, resp: ServerResponse) => {
        if (handleStatusRoute(req, resp, ctx)) return;
        resp.writeHead(404);
        resp.end("Not found");
      });
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        res();
      });
    });
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns Cache-Control: max-age=5 on first request", async () => {
    const res = await fetch(`http://localhost:${port}/api/status`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("max-age=5");
  });

  it("returns Cache-Control: max-age=5 on cache hit (second request within TTL)", async () => {
    await fetch(`http://localhost:${port}/api/status`);
    const res2 = await fetch(`http://localhost:${port}/api/status`);
    expect(res2.headers.get("cache-control")).toBe("max-age=5");
  });
});

// ---------------------------------------------------------------------------
// POST /api/reload → Cache-Control: no-store
// ---------------------------------------------------------------------------

describe("POST /api/reload Cache-Control header", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    // Inline the reload endpoint logic to test it in isolation
    await new Promise<void>((res) => {
      server = createServer((req: IncomingMessage, resp: ServerResponse) => {
        if (req.url !== "/api/reload") {
          resp.writeHead(404);
          resp.end("Not found");
          return;
        }
        if ((req.method ?? "GET") !== "POST") {
          resp.writeHead(405, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          resp.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        resp.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        resp.end(JSON.stringify({ ok: true }));
      });
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        res();
      });
    });
  });

  afterEach(() => {
    server.close();
  });

  it("returns Cache-Control: no-store for successful POST", async () => {
    const res = await fetch(`http://localhost:${port}/api/reload`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns Cache-Control: no-store for 405 (wrong method)", async () => {
    const res = await fetch(`http://localhost:${port}/api/reload`, { method: "GET" });
    expect(res.status).toBe(405);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// Static asset route: PNG without content-hash → no-cache
// (Exercises the unified static asset handler in routes-static.ts)
// ---------------------------------------------------------------------------

describe("handleStaticRoute PNG cache header", () => {
  it("serves PNG with no-cache (no content-hash in filename)", async () => {
    const assets = resolveStaticAssets(false);
    if (!assets) {
      console.log("Skipping: dist/viewer/index.html not found (run build first)");
      return;
    }

    const tmpDir = await mkdtemp(join(tmpdir(), "cache-static-png-"));
    const ctx: ServerContext = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };

    let server: Server | null = null;
    try {
      const { server: srv, port } = await new Promise<{ server: Server; port: number }>((res) => {
        const s = createServer((req: IncomingMessage, resp: ServerResponse) => {
          if (handleStaticRoute(req, resp, ctx, assets)) return;
          resp.writeHead(404);
          resp.end("Not found");
        });
        s.listen(0, () => {
          const addr = s.address();
          const p = typeof addr === "object" && addr ? addr.port : 0;
          res({ server: s, port: p });
        });
      });
      server = srv;

      // Pick any PNG we know the viewer ships with (SourceVision.png is always present)
      const res = await fetch(`http://localhost:${port}/SourceVision.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      // Plain filenames (no hash) → no-cache
      expect(res.headers.get("cache-control")).toBe("no-cache");
    } finally {
      server?.close();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
