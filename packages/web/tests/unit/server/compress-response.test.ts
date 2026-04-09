/**
 * Unit tests for compress-response.ts
 *
 * Uses a real in-process HTTP server so we test the full interaction
 * between the deferred writeHead patch, Node.js response buffering,
 * and actual HTTP responses — no mocks for the response path.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, get as httpGet, type Server } from "node:http";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import {
  applyCompression,
  preferredEncoding,
  isCompressible,
  COMPRESSION_THRESHOLD_BYTES,
} from "../../../src/server/compress-response.js";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Repeat a string until it is at least `minBytes` long (UTF-8). */
function padToSize(s: string, minBytes: number): string {
  while (Buffer.byteLength(s, "utf-8") < minBytes) s = s + s;
  return s;
}

const LARGE_JSON = padToSize('{"message":"hello world"}', COMPRESSION_THRESHOLD_BYTES + 1);
const SMALL_JSON = '{"ok":true}'; // well under 1 KB

/** Start a one-shot test server that sends `body` with the given content-type
 *  after calling applyCompression.  Returns { server, port }. */
function startTestServer(
  body: string | Buffer,
  contentType: string,
  statusCode = 200,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      applyCompression(req, res);
      res.writeHead(statusCode, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      });
      res.end(body);
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

/**
 * Make an HTTP GET request to the given URL with optional headers.
 * Returns a Promise that resolves with { headers, bodyBuffer }.
 * All assertion errors inside the callback are forwarded to reject.
 */
function httpGetRaw(
  port: number,
  headers: Record<string, string> = {},
): Promise<{ headers: Record<string, string | string[] | undefined>; bodyBuffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpGet(
      `http://localhost:${port}/`,
      { headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({
              headers: res.headers as Record<string, string | string[] | undefined>,
              bodyBuffer: Buffer.concat(chunks),
            });
          } catch (e) {
            reject(e);
          }
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
  });
}

// ── pure-unit: preferredEncoding ─────────────────────────────────────────────

describe("preferredEncoding", () => {
  it("returns null when no Accept-Encoding header", () => {
    const req = { headers: {} } as Parameters<typeof preferredEncoding>[0];
    expect(preferredEncoding(req)).toBeNull();
  });

  it("returns gzip when Accept-Encoding: gzip", () => {
    const req = {
      headers: { "accept-encoding": "gzip, deflate" },
    } as Parameters<typeof preferredEncoding>[0];
    expect(preferredEncoding(req)).toBe("gzip");
  });

  it("prefers br over gzip when both are listed", () => {
    const req = {
      headers: { "accept-encoding": "gzip, deflate, br" },
    } as Parameters<typeof preferredEncoding>[0];
    expect(preferredEncoding(req)).toBe("br");
  });

  it("returns br when only br is listed", () => {
    const req = {
      headers: { "accept-encoding": "br" },
    } as Parameters<typeof preferredEncoding>[0];
    expect(preferredEncoding(req)).toBe("br");
  });
});

// ── pure-unit: isCompressible ─────────────────────────────────────────────────

describe("isCompressible", () => {
  it.each([
    "application/json",
    "application/json; charset=utf-8",
    "text/html",
    "text/plain",
    "text/css",
    "text/javascript",
    "text/xml",
    "application/javascript",
    "application/xml",
    "image/svg+xml",
  ])("returns true for %s", (ct) => {
    expect(isCompressible(ct)).toBe(true);
  });

  it.each([
    "text/event-stream",
    "image/png",
    "image/jpeg",
    "application/octet-stream",
    "multipart/form-data",
    undefined,
  ])("returns false for %s", (ct) => {
    expect(isCompressible(ct)).toBe(false);
  });
});

// ── integration: gzip ────────────────────────────────────────────────────────

describe("applyCompression — gzip", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    ({ server, port } = await startTestServer(LARGE_JSON, "application/json"));
  });

  afterEach(() => {
    server.close();
  });

  it("sets Content-Encoding: gzip and Vary: Accept-Encoding for large JSON", async () => {
    const { headers, bodyBuffer } = await httpGetRaw(port, { "Accept-Encoding": "gzip" });
    expect(headers["content-encoding"]).toBe("gzip");
    expect(headers["vary"]).toContain("Accept-Encoding");
    expect(headers["content-length"]).toBeUndefined();
    // Decompressed body must match original
    const decompressed = gunzipSync(bodyBuffer);
    expect(decompressed.toString("utf-8")).toBe(LARGE_JSON);
  });

  it("does NOT compress responses below the threshold", async () => {
    const { server: s2, port: p2 } = await startTestServer(
      SMALL_JSON,
      "application/json",
    );
    try {
      const { headers, bodyBuffer } = await httpGetRaw(p2, { "Accept-Encoding": "gzip" });
      expect(headers["content-encoding"]).toBeUndefined();
      expect(bodyBuffer.toString("utf-8")).toBe(SMALL_JSON);
    } finally {
      s2.close();
    }
  });

  it("does NOT compress non-compressible content types", async () => {
    const pngBody = Buffer.alloc(COMPRESSION_THRESHOLD_BYTES + 1, 0x89);
    const { server: s2, port: p2 } = await startTestServer(pngBody, "image/png");
    try {
      const { headers, bodyBuffer } = await httpGetRaw(p2, { "Accept-Encoding": "gzip" });
      expect(headers["content-encoding"]).toBeUndefined();
      expect(bodyBuffer.length).toBe(pngBody.length);
      expect(bodyBuffer[0]).toBe(0x89);
    } finally {
      s2.close();
    }
  });

  it("does NOT compress text/event-stream (SSE)", async () => {
    const { server: s2, port: p2 } = await startTestServer(
      padToSize("data: hello\n\n", COMPRESSION_THRESHOLD_BYTES + 1),
      "text/event-stream",
    );
    try {
      const { headers } = await httpGetRaw(p2, { "Accept-Encoding": "gzip" });
      expect(headers["content-encoding"]).toBeUndefined();
    } finally {
      s2.close();
    }
  });

  it("sends uncompressed response when client omits Accept-Encoding", async () => {
    const { headers, bodyBuffer } = await httpGetRaw(port);
    expect(headers["content-encoding"]).toBeUndefined();
    expect(bodyBuffer.toString("utf-8")).toBe(LARGE_JSON);
  });

  it("compressed size is ≤ 40% of original for repetitive JSON payload", async () => {
    const { headers, bodyBuffer } = await httpGetRaw(port, { "Accept-Encoding": "gzip" });
    expect(headers["content-encoding"]).toBe("gzip");
    const ratio = bodyBuffer.length / Buffer.byteLength(LARGE_JSON, "utf-8");
    expect(ratio).toBeLessThanOrEqual(0.4);
  });
});

// ── integration: brotli ──────────────────────────────────────────────────────

describe("applyCompression — brotli", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    ({ server, port } = await startTestServer(LARGE_JSON, "application/json"));
  });

  afterEach(() => {
    server.close();
  });

  it("uses brotli when client prefers br over gzip", async () => {
    const { headers, bodyBuffer } = await httpGetRaw(port, {
      "Accept-Encoding": "gzip, deflate, br",
    });
    expect(headers["content-encoding"]).toBe("br");
    expect(headers["vary"]).toContain("Accept-Encoding");
    const decompressed = brotliDecompressSync(bodyBuffer);
    expect(decompressed.toString("utf-8")).toBe(LARGE_JSON);
  });
});

// ── integration: SSE passthrough ─────────────────────────────────────────────

describe("applyCompression — SSE streaming passthrough", () => {
  it("does not compress when res.write() is called before res.end()", async () => {
    const server = createServer((req, res) => {
      applyCompression(req, res);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: hello\n\n");
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    try {
      const { headers, bodyBuffer } = await httpGetRaw(port, {
        "Accept-Encoding": "gzip",
      });
      expect(headers["content-encoding"]).toBeUndefined();
      expect(bodyBuffer.toString()).toBe("data: hello\n\n");
    } finally {
      server.close();
    }
  });
});

// ── integration: fetch compatibility ────────────────────────────────────────

describe("applyCompression — fetch auto-decompression compatibility", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    ({ server, port } = await startTestServer(LARGE_JSON, "application/json"));
  });

  afterEach(() => {
    server.close();
  });

  it("fetch receives the correct body when server sends gzip", async () => {
    // fetch auto-decompresses gzip — the body should equal the original JSON
    const res = await fetch(`http://localhost:${port}/`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(LARGE_JSON);
  });
});
