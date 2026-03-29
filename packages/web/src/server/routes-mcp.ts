/**
 * MCP over HTTP routes — mounts rex and sourcevision MCP servers on the web server.
 *
 * POST/GET/DELETE /mcp/rex          — Rex MCP endpoint (Streamable HTTP transport)
 * POST/GET/DELETE /mcp/sourcevision — Sourcevision MCP endpoint (Streamable HTTP transport)
 *
 * Each endpoint manages its own transport + MCP server lifecycle.
 * Sessions are stateful (session ID generated per initialize request).
 *
 * Unlike the REST API routes (which read JSON files from disk and shell
 * out to CLIs), MCP routes require the actual MCP server factory
 * functions at runtime.  These are the **only** cross-package runtime
 * imports in the web package, isolated in gateway modules.
 *
 * @see ./rex-gateway.ts — Rex runtime gateway
 * @see ./domain-gateway.ts — Sourcevision runtime gateway
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRexMcpServer } from "./rex-gateway.js";
import { createSourcevisionMcpServer } from "./domain-gateway.js";
import type { ServerContext } from "./types.js";
import {
  applyParallelModeBlocking,
  REX_PARALLEL_ALLOWED_TOOLS,
} from "./utils/parallel-mode.js";

const MCP_REX_PATH = "/mcp/rex";
const MCP_SV_PATH = "/mcp/sourcevision";

/**
 * A per-session MCP transport + server pair.
 * Sessions are identified by the Mcp-Session-Id header.
 */
interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  /** Timestamp of last activity (Date.now()), used for TTL-based cleanup. */
  lastActivityAt: number;
  /** Root directory override for this session (from X-Ndx-Root-Dir header at init). Absent when using server default. */
  rootDir?: string;
}

/** Session maps keyed by session ID. */
const rexSessions = new Map<string, McpSession>();
const svSessions = new Map<string, McpSession>();

// ── Session TTL cleanup ──────────────────────────────────────────────────────

/** Maximum session idle time before automatic cleanup (15 minutes). */
const SESSION_TTL_MS = 15 * 60 * 1000;

/** How often to sweep for stale sessions (5 minutes). */
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Sweep a session map, closing sessions idle longer than SESSION_TTL_MS. */
function sweepStaleSessions(sessions: Map<string, McpSession>): void {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (now - session.lastActivityAt > SESSION_TTL_MS) {
      session.transport.close().catch(() => {});
      sessions.delete(sid);
    }
  }
}

/** Periodic sweep timer (started lazily on first session creation). */
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function ensureSweepTimer(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepStaleSessions(rexSessions);
    sweepStaleSessions(svSessions);
    // Stop the timer if no sessions remain — avoid holding the process open
    if (rexSessions.size === 0 && svSessions.size === 0 && sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }, SESSION_SWEEP_INTERVAL_MS);
  // Don't prevent process exit
  if (sweepTimer.unref) sweepTimer.unref();
}

type McpServerFactory = (rootDir: string) => McpServer | Promise<McpServer>;

/** Factory that creates a Rex MCP server instance. */
const createRexServer: McpServerFactory = (rootDir) =>
  createRexMcpServer(rootDir);

/** Factory that creates a Sourcevision MCP server instance. */
const createSvServer: McpServerFactory = (rootDir) =>
  createSourcevisionMcpServer(rootDir);

/**
 * Parse and validate the X-Ndx-Root-Dir header value.
 *
 * @returns The resolved absolute path, or `null` if the header is absent.
 * @throws {Error} With a user-facing message when the header is present but invalid
 *         (relative path, non-existent, or not a directory).
 */
function parseRootDirHeader(req: IncomingMessage): string | null {
  const raw = req.headers["x-ndx-root-dir"];
  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (!isAbsolute(trimmed)) {
    throw new Error("X-Ndx-Root-Dir must be an absolute path");
  }

  const resolved = resolve(trimmed); // normalize away any /../ segments

  if (!existsSync(resolved)) {
    throw new Error(`X-Ndx-Root-Dir path does not exist: ${resolved}`);
  }

  const stat = statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`X-Ndx-Root-Dir is not a directory: ${resolved}`);
  }

  return resolved;
}

/**
 * Create a new MCP session: transport + server, connected but not yet handling requests.
 * The session is registered in the session map once the transport assigns a session ID
 * (which happens during the first handleRequest call for the initialize request).
 *
 * @param rootDir - The project directory for this session's MCP server.
 * @param sessions - Session map to register cleanup hooks on.
 * @param factory - Factory function that creates the MCP server for the given rootDir.
 * @param sessionRootDir - If set, stored on the session to indicate an explicit override.
 * @param parallelAllowed - If set, apply parallel-mode blocking using this allowlist.
 */
async function createSession(
  rootDir: string,
  sessions: Map<string, McpSession>,
  factory: McpServerFactory,
  sessionRootDir?: string,
  parallelAllowed?: ReadonlySet<string>,
): Promise<McpSession> {
  const server = await factory(rootDir);

  // Worktree-scoped sessions get parallel-mode blocking: only allowed tools
  // remain functional, all others return a clear error response.
  if (sessionRootDir && parallelAllowed) {
    applyParallelModeBlocking(server, parallelAllowed);
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };
  await server.connect(transport);
  ensureSweepTimer();
  return { transport, server, lastActivityAt: Date.now(), rootDir: sessionRootDir };
}

/**
 * Look up an existing session by the Mcp-Session-Id header, or return null
 * if no session header is present (indicating an initialization request).
 */
function findSession(
  req: IncomingMessage,
  sessions: Map<string, McpSession>,
): McpSession | null {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || typeof sessionId !== "string") return null;
  return sessions.get(sessionId) ?? null;
}

/**
 * Handle an MCP HTTP request for a given endpoint.
 *
 * - POST without session header → create new session, delegate to transport, register session
 * - POST/GET/DELETE with session header → delegate to existing transport
 * - Unknown session → 404
 */
async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  sessions: Map<string, McpSession>,
  factory: McpServerFactory,
  parallelAllowed?: ReadonlySet<string>,
): Promise<boolean> {
  const method = req.method || "GET";

  // POST requests: either initialization (no session) or existing session
  if (method === "POST") {
    const existing = findSession(req, sessions);
    if (existing) {
      // Subsequent requests on an existing session — header is ignored after init.
      existing.lastActivityAt = Date.now();
      await existing.transport.handleRequest(req, res);
      return true;
    }
    // No session header — this should be an initialization request.
    // Parse optional X-Ndx-Root-Dir header to scope this session to a specific directory.
    let overrideDir: string | null;
    try {
      overrideDir = parseRootDirHeader(req);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid X-Ndx-Root-Dir header";
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
      return true;
    }

    const effectiveDir = overrideDir ?? ctx.projectDir;
    // Create transport + server, handle the request, then register the session.
    // Worktree-scoped sessions (overrideDir set) get parallel-mode tool blocking.
    const session = await createSession(
      effectiveDir, sessions, factory,
      overrideDir ?? undefined,
      overrideDir ? parallelAllowed : undefined,
    );
    await session.transport.handleRequest(req, res);
    // After handleRequest, the transport has generated a session ID
    const sid = session.transport.sessionId;
    if (sid) sessions.set(sid, session);
    return true;
  }

  // GET (SSE streaming) and DELETE (session termination) require an existing session
  if (method === "GET" || method === "DELETE") {
    const existing = findSession(req, sessions);
    if (!existing) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No valid session. Send an initialization request first." }));
      return true;
    }
    existing.lastActivityAt = Date.now();
    await existing.transport.handleRequest(req, res);
    return true;
  }

  // Unsupported method
  res.writeHead(405, { "Content-Type": "application/json", Allow: "GET, POST, DELETE" });
  res.end(JSON.stringify({ error: "Method not allowed" }));
  return true;
}

/**
 * Route handler for MCP endpoints.
 *
 * Handles `/mcp/rex` and `/mcp/sourcevision` paths.
 * Returns `true` if the request was handled, `false` otherwise.
 */
export async function handleMcpRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url ?? "/";
  // Strip query string for path matching
  const path = url.split("?")[0];

  if (path === MCP_REX_PATH) {
    return handleMcpRequest(req, res, ctx, rexSessions, createRexServer, REX_PARALLEL_ALLOWED_TOOLS);
  }

  if (path === MCP_SV_PATH) {
    // All SV tools are read-only — no parallel-mode blocking needed.
    return handleMcpRequest(req, res, ctx, svSessions, createSvServer);
  }

  return false;
}

/**
 * Close all active MCP sessions and stop the sweep timer.
 * Used for graceful shutdown.
 */
export async function closeAllMcpSessions(): Promise<void> {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  const closers: Promise<void>[] = [];
  for (const session of rexSessions.values()) {
    closers.push(session.transport.close());
  }
  for (const session of svSessions.values()) {
    closers.push(session.transport.close());
  }
  await Promise.allSettled(closers);
  rexSessions.clear();
  svSessions.clear();
}
