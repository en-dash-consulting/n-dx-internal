/**
 * Integration tests for session-scoped MCP isolation.
 *
 * Verifies that a single web server can serve multiple MCP sessions scoped to
 * different root directories via the X-Ndx-Root-Dir header. Each session gets
 * its own PRDStore backed by the target directory's .rex/prd.json, so mutations
 * in one session never leak into another.
 *
 * Test fixture layout:
 *   primaryDir/   — server's default projectDir (ctx.projectDir)
 *   worktreeA/    — first alternate root (distinct PRD)
 *   worktreeB/    — second alternate root (distinct PRD)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ServerContext } from "../../src/server/types.js";
import {
  handleMcpRoute,
  closeAllMcpSessions,
} from "../../src/server/routes-mcp.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Create a minimal PRD document with the given title and items. */
function makePRD(title: string, items?: unknown[]) {
  return {
    schema: "rex/v1",
    title,
    items: items ?? [
      {
        id: "epic-1",
        title: `${title} Epic`,
        status: "pending",
        level: "epic",
        priority: "high",
        children: [
          {
            id: "task-1",
            title: `${title} Task`,
            status: "pending",
            level: "task",
            priority: "high",
          },
        ],
      },
    ],
  };
}

/** Minimal sourcevision manifest so the MCP server can initialize. */
function makeManifest() {
  return {
    version: "0.1.0",
    analyzedAt: new Date().toISOString(),
    projectRoot: "/tmp/test",
    stats: { files: 0, imports: 0, zones: 0 },
  };
}

/** Seed a directory with .rex/prd.json and .sourcevision/manifest.json. */
async function seedProjectDir(dir: string, prdTitle: string): Promise<void> {
  const rexDir = join(dir, ".rex");
  const svDir = join(dir, ".sourcevision");
  await mkdir(rexDir, { recursive: true });
  await mkdir(svDir, { recursive: true });
  await writeFile(
    join(rexDir, "prd.json"),
    JSON.stringify(makePRD(prdTitle), null, 2),
  );
  await writeFile(
    join(svDir, "manifest.json"),
    JSON.stringify(makeManifest(), null, 2),
  );
}

// ── Test server helper ──────────────────────────────────────────────────────

/** Start a lightweight HTTP server that only handles MCP routes. */
function startTestServer(
  ctx: ServerContext,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        // Mirror CORS setup from start.ts
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, PATCH, DELETE, OPTIONS",
        );
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Mcp-Session-Id, X-Ndx-Root-Dir",
        );
        res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

        if ((req.method || "GET") === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        if (await handleMcpRoute(req, res, ctx)) return;

        res.writeHead(404);
        res.end("Not found");
      },
    );
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

// ── MCP client helpers ──────────────────────────────────────────────────────

/** Create and connect an MCP client to /mcp/rex, optionally scoped to a rootDir. */
async function connectRexClient(
  port: number,
  rootDir?: string,
): Promise<Client> {
  const client = new Client({
    name: "scoping-test-client",
    version: "1.0.0",
  });
  const headers: Record<string, string> = {};
  if (rootDir) headers["X-Ndx-Root-Dir"] = rootDir;

  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${port}/mcp/rex`),
    rootDir ? { requestInit: { headers } } : undefined,
  );
  await client.connect(transport);
  return client;
}

/** Extract the text payload from an MCP tool result. */
function extractText(
  result: Awaited<ReturnType<Client["callTool"]>>,
): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0]?.text ?? "";
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("MCP session-scoped isolation", () => {
  let primaryDir: string;
  let worktreeA: string;
  let worktreeB: string;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    // Create three distinct project directories
    [primaryDir, worktreeA, worktreeB] = await Promise.all([
      mkdtemp(join(tmpdir(), "mcp-scope-primary-")),
      mkdtemp(join(tmpdir(), "mcp-scope-wt-a-")),
      mkdtemp(join(tmpdir(), "mcp-scope-wt-b-")),
    ]);

    // Seed each with a distinct PRD title
    await Promise.all([
      seedProjectDir(primaryDir, "Primary Project"),
      seedProjectDir(worktreeA, "Worktree Alpha"),
      seedProjectDir(worktreeB, "Worktree Beta"),
    ]);

    const ctx: ServerContext = {
      projectDir: primaryDir,
      svDir: join(primaryDir, ".sourcevision"),
      rexDir: join(primaryDir, ".rex"),
      dev: false,
    };

    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeAllMcpSessions();
    server.close();
    await Promise.all([
      rm(primaryDir, { recursive: true, force: true }),
      rm(worktreeA, { recursive: true, force: true }),
      rm(worktreeB, { recursive: true, force: true }),
    ]);
  });

  // ── AC: rex_status returns correct PRD per session ──────────────────────

  it("sessions scoped to different rootDirs return distinct PRD trees", async () => {
    const clientA = await connectRexClient(port, worktreeA);
    const clientB = await connectRexClient(port, worktreeB);

    try {
      const [resultA, resultB] = await Promise.all([
        clientA.callTool({ name: "get_prd_status", arguments: {} }),
        clientB.callTool({ name: "get_prd_status", arguments: {} }),
      ]);

      const prdA = JSON.parse(extractText(resultA));
      const prdB = JSON.parse(extractText(resultB));

      expect(prdA.title).toBe("Worktree Alpha");
      expect(prdB.title).toBe("Worktree Beta");
      expect(prdA.title).not.toBe(prdB.title);
    } finally {
      await Promise.all([clientA.close(), clientB.close()]);
    }
  });

  // ── AC: rex_update in session A does not modify session B's PRD ─────────

  it("update_task_status in session A does not affect session B", async () => {
    const clientA = await connectRexClient(port, worktreeA);
    const clientB = await connectRexClient(port, worktreeB);

    try {
      // Verify both sessions see their task as pending initially
      const beforeA = JSON.parse(
        extractText(
          await clientA.callTool({
            name: "get_item",
            arguments: { id: "task-1" },
          }),
        ),
      );
      const beforeB = JSON.parse(
        extractText(
          await clientB.callTool({
            name: "get_item",
            arguments: { id: "task-1" },
          }),
        ),
      );
      expect(beforeA.item.status).toBe("pending");
      expect(beforeB.item.status).toBe("pending");

      // Update task-1 to completed in session A only
      const updateResult = await clientA.callTool({
        name: "update_task_status",
        arguments: {
          id: "task-1",
          status: "completed",
          resolutionType: "code-change",
          resolutionDetail: "Test completion",
        },
      });
      expect(updateResult.isError).toBeFalsy();

      // Session A should reflect the update
      const afterA = JSON.parse(
        extractText(
          await clientA.callTool({
            name: "get_item",
            arguments: { id: "task-1" },
          }),
        ),
      );
      expect(afterA.item.status).toBe("completed");

      // Session B should be unaffected — still pending
      const afterB = JSON.parse(
        extractText(
          await clientB.callTool({
            name: "get_item",
            arguments: { id: "task-1" },
          }),
        ),
      );
      expect(afterB.item.status).toBe("pending");

      // Verify on disk: worktreeA's prd.json has the update, worktreeB's does not
      const diskA = JSON.parse(
        await readFile(join(worktreeA, ".rex", "prd.json"), "utf-8"),
      );
      const diskB = JSON.parse(
        await readFile(join(worktreeB, ".rex", "prd.json"), "utf-8"),
      );

      const taskA = diskA.items[0]?.children?.[0];
      const taskB = diskB.items[0]?.children?.[0];
      expect(taskA?.status).toBe("completed");
      expect(taskB?.status).toBe("pending");
    } finally {
      await Promise.all([clientA.close(), clientB.close()]);
    }
  });

  // ── AC: Default session (no header) reads from server's projectDir ──────

  it("session without X-Ndx-Root-Dir header uses server projectDir", async () => {
    // No rootDir argument → no X-Ndx-Root-Dir header
    const client = await connectRexClient(port);

    try {
      const result = await client.callTool({
        name: "get_prd_status",
        arguments: {},
      });
      const prd = JSON.parse(extractText(result));
      expect(prd.title).toBe("Primary Project");
    } finally {
      await client.close();
    }
  });

  it("default session and scoped session coexist independently", async () => {
    const defaultClient = await connectRexClient(port);
    const scopedClient = await connectRexClient(port, worktreeA);

    try {
      const [defaultResult, scopedResult] = await Promise.all([
        defaultClient.callTool({ name: "get_prd_status", arguments: {} }),
        scopedClient.callTool({ name: "get_prd_status", arguments: {} }),
      ]);

      const defaultPrd = JSON.parse(extractText(defaultResult));
      const scopedPrd = JSON.parse(extractText(scopedResult));

      expect(defaultPrd.title).toBe("Primary Project");
      expect(scopedPrd.title).toBe("Worktree Alpha");
    } finally {
      await Promise.all([defaultClient.close(), scopedClient.close()]);
    }
  });

  // ── AC: Blocked tools (rex_add) return error in worktree sessions ───────
  // Depends on sibling task: "Parallel-mode tool blocking for scoped MCP sessions"
  // (ID: 1f3de12b-cbef-4187-9832-9b1118c296ae)
  // Once that task is implemented, remove .todo and the test should pass.

  it.todo(
    "add_item returns parallel-mode error in worktree-scoped sessions",
  );

  // ── Cross-session mutation isolation (edit_item) ────────────────────────

  it("edit_item in one session does not leak to another", async () => {
    const clientA = await connectRexClient(port, worktreeA);
    const clientB = await connectRexClient(port, worktreeB);

    try {
      // Edit task title in session A
      const editResult = await clientA.callTool({
        name: "edit_item",
        arguments: { id: "task-1", title: "Mutated in Alpha" },
      });
      expect(editResult.isError).toBeFalsy();

      // Session A should see the updated title
      const itemA = JSON.parse(
        extractText(
          await clientA.callTool({
            name: "get_item",
            arguments: { id: "task-1" },
          }),
        ),
      );
      expect(itemA.item.title).toBe("Mutated in Alpha");

      // Session B should still see the original title
      const itemB = JSON.parse(
        extractText(
          await clientB.callTool({
            name: "get_item",
            arguments: { id: "task-1" },
          }),
        ),
      );
      expect(itemB.item.title).toBe("Worktree Beta Task");
    } finally {
      await Promise.all([clientA.close(), clientB.close()]);
    }
  });

  // ── Three-way isolation: primary + two worktrees ────────────────────────

  it("three concurrent sessions (primary + two worktrees) are fully isolated", async () => {
    const primaryClient = await connectRexClient(port);
    const clientA = await connectRexClient(port, worktreeA);
    const clientB = await connectRexClient(port, worktreeB);

    try {
      // All three return their own PRD titles
      const [primaryResult, resultA, resultB] = await Promise.all([
        primaryClient.callTool({ name: "get_prd_status", arguments: {} }),
        clientA.callTool({ name: "get_prd_status", arguments: {} }),
        clientB.callTool({ name: "get_prd_status", arguments: {} }),
      ]);

      expect(JSON.parse(extractText(primaryResult)).title).toBe(
        "Primary Project",
      );
      expect(JSON.parse(extractText(resultA)).title).toBe("Worktree Alpha");
      expect(JSON.parse(extractText(resultB)).title).toBe("Worktree Beta");

      // Mutate in session A, verify no cross-contamination
      await clientA.callTool({
        name: "update_task_status",
        arguments: { id: "task-1", status: "in_progress" },
      });

      // Verify primary and B are unaffected
      const primaryItem = JSON.parse(
        extractText(
          await primaryClient.callTool({
            name: "get_item",
            arguments: { id: "task-1" },
          }),
        ),
      );
      const itemB = JSON.parse(
        extractText(
          await clientB.callTool({
            name: "get_item",
            arguments: { id: "task-1" },
          }),
        ),
      );

      expect(primaryItem.item.status).toBe("pending");
      expect(itemB.item.status).toBe("pending");

      // Session A should show in_progress
      const itemA = JSON.parse(
        extractText(
          await clientA.callTool({
            name: "get_item",
            arguments: { id: "task-1" },
          }),
        ),
      );
      expect(itemA.item.status).toBe("in_progress");
    } finally {
      await Promise.all([
        primaryClient.close(),
        clientA.close(),
        clientB.close(),
      ]);
    }
  });
});
