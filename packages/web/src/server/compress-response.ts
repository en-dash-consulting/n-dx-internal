/**
 * HTTP response compression for the web server.
 *
 * Applies transparent gzip or brotli compression to eligible responses,
 * using Node.js built-in `zlib` (no external dependencies).
 *
 * ## Eligibility criteria (all must be satisfied)
 * - Client sends `Accept-Encoding: gzip` or `Accept-Encoding: br`
 * - `Content-Type` is a known compressible type (text/html, application/json, etc.)
 * - Response body is ≥ 1 024 bytes
 * - No data was streamed via `res.write()` before `res.end()` (SSE/chunked exempt)
 *
 * ## Implementation note
 * Routes call `res.writeHead(status, headers)` followed by `res.end(body)`.
 * In vanilla Node.js, headers set via `writeHead()` are not accessible through
 * `res.getHeader()` and the header buffer (`_header`) is finalised at writeHead
 * time — making it impossible to inject `Content-Encoding` afterwards.
 *
 * To work around this, `applyCompression` defers the actual `writeHead` call:
 * it captures the status + headers in memory and flushes them (with any
 * compression headers injected) just before the body is written.
 *
 * ## Usage
 * Call `applyCompression(req, res)` at the very beginning of each request
 * handler, before any `res.write()` or `res.end()` calls.  Route handlers
 * continue to write responses exactly as they do today — no call-site changes.
 *
 * @module compress-response
 */

import {
  gzipSync,
  brotliCompressSync,
  constants as zlibConstants,
} from "node:zlib";
import type {
  IncomingMessage,
  ServerResponse,
  OutgoingHttpHeaders,
} from "node:http";

/** Minimum uncompressed body size (bytes) to attempt compression. */
export const COMPRESSION_THRESHOLD_BYTES = 1024;

/**
 * Content-type patterns eligible for compression.
 *
 * Explicitly excluded:
 * - `text/event-stream` (SSE — already chunked, compression incompatible)
 * - `image/*` binary types (already compressed)
 * - `multipart/*` (mixed content)
 */
const COMPRESSIBLE =
  /^(text\/(html|css|plain|javascript|xml)|application\/(json|javascript|xml|wasm)|image\/svg\+xml)/i;

/** Supported content-encoding values, ordered by preference. */
type Encoding = "br" | "gzip";

/** Pending deferred writeHead call. */
interface PendingHead {
  status: number;
  statusMessage?: string;
  headers: OutgoingHttpHeaders;
}

/**
 * Determine the best encoding the client will accept.
 * Brotli is preferred over gzip when both are listed.
 */
export function preferredEncoding(req: IncomingMessage): Encoding | null {
  const ae = String(req.headers["accept-encoding"] ?? "");
  // Intentionally simple: no quality-value (q=) parsing.
  // Brotli wins if listed anywhere in the header.
  if (ae.includes("br")) return "br";
  if (ae.includes("gzip")) return "gzip";
  return null;
}

/**
 * Return true if the given Content-Type value should be compressed.
 * The media-type part (before the first `;`) is matched against COMPRESSIBLE.
 */
export function isCompressible(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";")[0]!.trim();
  return COMPRESSIBLE.test(mediaType);
}

/**
 * Compress `body` with the given encoding.
 * Brotli quality 4 balances compression ratio against latency.
 * Throws on error — callers should fall back to uncompressed.
 */
function compress(body: Buffer, encoding: Encoding): Buffer {
  if (encoding === "br") {
    return brotliCompressSync(body, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
    });
  }
  return gzipSync(body);
}

/**
 * Extract the Content-Type value from a headers object (case-insensitive).
 * Routes may use either capitalisation.
 */
function extractContentType(
  headers: OutgoingHttpHeaders | undefined,
): string | undefined {
  if (!headers) return undefined;
  const ct = headers["content-type"] ?? headers["Content-Type"];
  return ct != null ? String(ct) : undefined;
}

/**
 * Patch `res.writeHead`, `res.write`, and `res.end` to apply transparent
 * compression when the response meets the eligibility criteria.
 *
 * **Deferred writeHead** — `writeHead` is captured in memory and not written
 * to the socket until `end()` fires.  This lets us inject `Content-Encoding`
 * and `Vary` headers before the header block is finalised.
 *
 * Must be called before the first `res.write()` or `res.end()` call on this
 * response.  All three methods are restored to their originals after `end()`
 * runs (compressed or not).
 *
 * The function is a no-op when the client does not advertise a supported
 * encoding — the fast path exits immediately without patching.
 */
export function applyCompression(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const enc = preferredEncoding(req);
  if (!enc) return; // Fast path — avoid patching overhead entirely

  const origWriteHead = res.writeHead.bind(res);
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);

  let pending: PendingHead | null = null;
  let streamed = false;

  /** Restore all three patched methods to their originals. */
  function restore(): void {
    (res as { writeHead: typeof res.writeHead }).writeHead =
      origWriteHead as typeof res.writeHead;
    res.write = origWrite;
    res.end = origEnd;
  }

  /**
   * Flush the deferred writeHead to the socket.
   * statusMessage is forwarded only when the caller supplied one.
   */
  function flushWriteHead(): void {
    if (!pending) return;
    const { status, statusMessage, headers } = pending;
    pending = null;
    if (statusMessage !== undefined) {
      (
        origWriteHead as (
          s: number,
          m: string,
          h: OutgoingHttpHeaders,
        ) => ServerResponse
      )(status, statusMessage, headers);
    } else {
      (
        origWriteHead as (s: number, h: OutgoingHttpHeaders) => ServerResponse
      )(status, headers);
    }
  }

  // ── Intercept writeHead ──────────────────────────────────────────────────
  // Capture status + headers without calling the original.  The original is
  // called in end() so that we can still inject compression headers.
  (
    res as { writeHead: (...args: unknown[]) => ServerResponse }
  ).writeHead = function (...args: unknown[]): ServerResponse {
    const [statusCode, ...rest] = args;
    let statusMessage: string | undefined;
    let headers: OutgoingHttpHeaders = {};

    for (const arg of rest) {
      if (typeof arg === "string") {
        statusMessage = arg;
      } else if (typeof arg === "object" && arg !== null) {
        headers = arg as OutgoingHttpHeaders;
      }
    }

    pending = { status: Number(statusCode), statusMessage, headers };
    return res;
  };

  // ── Intercept write ──────────────────────────────────────────────────────
  // The route is streaming (SSE, chunked, etc.) — we cannot buffer.
  // Flush the deferred writeHead unmodified and disable further patching.
  (res as { write: (...args: unknown[]) => boolean }).write = function (
    ...args: unknown[]
  ): boolean {
    streamed = true;
    restore();
    flushWriteHead();
    return (origWrite as (...args: unknown[]) => boolean)(...args);
  };

  // ── Intercept end ────────────────────────────────────────────────────────
  (res as { end: (...args: unknown[]) => ServerResponse }).end = function (
    ...args: unknown[]
  ): ServerResponse {
    restore();

    // Streaming path: writeHead was already flushed in write()
    if (streamed) {
      return (origEnd as (...args: unknown[]) => ServerResponse)(...args);
    }

    const [firstArg, secondArg, thirdArg] = args;

    // Empty body or callback-only call — flush unmodified and forward
    if (firstArg == null || typeof firstArg === "function") {
      flushWriteHead();
      return (origEnd as (...args: unknown[]) => ServerResponse)(...args);
    }

    // Normalise chunk to Buffer
    const chunkBuf =
      firstArg instanceof Buffer
        ? firstArg
        : firstArg instanceof Uint8Array
          ? Buffer.from(firstArg)
          : Buffer.from(
              String(firstArg),
              typeof secondArg === "string"
                ? (secondArg as BufferEncoding)
                : "utf-8",
            );

    // Check eligibility — content-type may be in the deferred writeHead
    // headers or in setHeader calls made before writeHead was invoked.
    const contentType =
      extractContentType(pending?.headers) ??
      (res.getHeader("content-type") as string | undefined);

    if (
      !isCompressible(contentType) ||
      chunkBuf.length < COMPRESSION_THRESHOLD_BYTES
    ) {
      flushWriteHead();
      return (origEnd as (...args: unknown[]) => ServerResponse)(...args);
    }

    // ── Apply compression ───────────────────────────────────────────────
    let compressed: Buffer;
    try {
      compressed = compress(chunkBuf, enc);
    } catch {
      // Compression failed — send the original body uncompressed
      flushWriteHead();
      return (origEnd as (...args: unknown[]) => ServerResponse)(...args);
    }

    // Inject compression headers into the pending writeHead.
    // If writeHead was never called (route only used setHeader + end),
    // use setHeader to add the compression headers instead.
    if (pending) {
      pending.headers = {
        ...pending.headers,
        "Content-Encoding": enc,
        Vary: "Accept-Encoding",
      };
      // Remove any explicit Content-Length — compressed size will differ
      delete pending.headers["Content-Length"];
      delete pending.headers["content-length"];
    } else {
      res.setHeader("Content-Encoding", enc);
      res.setHeader("Vary", "Accept-Encoding");
      res.removeHeader("Content-Length");
    }

    flushWriteHead();

    const cb =
      typeof secondArg === "function"
        ? secondArg
        : typeof thirdArg === "function"
          ? thirdArg
          : undefined;

    return cb
      ? (origEnd as (chunk: Buffer, cb: () => void) => ServerResponse)(
          compressed,
          cb as () => void,
        )
      : (origEnd as (chunk: Buffer) => ServerResponse)(compressed);
  };
}
