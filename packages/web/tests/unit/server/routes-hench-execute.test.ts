import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute } from "../../../src/server/routes-hench.js";

/** Minimal PRD document for testing. */
function makePRD(items: Array<Record<string, unknown>> = []): Record<string, unknown> {
  return {
    schema: "prd/v1",
    title: "Test PRD",
    items,
  };
}

/** Start a test server that routes through handleHenchRoute. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const result = handleHenchRoute(req, res, ctx);
      if (result instanceof Promise) {
        if (await result) return;
      } else if (result) {
        return;
      }
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

describe("POST /api/hench/execute", () => {
  let tmpDir: string;
  let rexDir: string;
  let henchDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-execute-api-"));
    rexDir = join(tmpDir, ".rex");
    henchDir = join(tmpDir, ".hench");
    await mkdir(rexDir, { recursive: true });
    await mkdir(henchDir, { recursive: true });
    await mkdir(join(henchDir, "runs"), { recursive: true });

    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir,
      dev: false,
    };

    const result = await startTestServer(ctx);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects request without taskId", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("taskId is required");
  });

  it("rejects invalid JSON", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Invalid JSON");
  });

  it("returns 404 when PRD not found", async () => {
    // No PRD file exists
    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "nonexistent" }),
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain("PRD not found");
  });

  it("returns 404 when task not found in PRD", async () => {
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-1", title: "Task One", status: "pending", level: "task" },
      ]), null, 2),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "nonexistent-id" }),
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain("not found in PRD");
  });

  it("rejects completed task with 409", async () => {
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-1", title: "Done Task", status: "completed", level: "task" },
      ]), null, 2),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toContain("completed");
    expect(body.error).toContain("cannot be executed");
  });

  it("rejects in_progress task with 409", async () => {
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-1", title: "Active Task", status: "in_progress", level: "task" },
      ]), null, 2),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toContain("in_progress");
  });

  it("rejects deferred task with 409", async () => {
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-1", title: "Deferred Task", status: "deferred", level: "task" },
      ]), null, 2),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(res.status).toBe(409);
  });

  it("finds nested tasks in PRD tree", async () => {
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        {
          id: "epic-1",
          title: "Epic",
          status: "pending",
          level: "epic",
          children: [
            {
              id: "feature-1",
              title: "Feature",
              status: "pending",
              level: "feature",
              children: [
                { id: "task-deep", title: "Deep Task", status: "completed", level: "task" },
              ],
            },
          ],
        },
      ]), null, 2),
    );

    // Task should be found but rejected because it's completed
    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-deep" }),
    });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toContain("completed");
  });

  it("accepts pending task and returns 202", async () => {
    // This test will attempt to spawn hench which won't exist in the test env,
    // but the endpoint should still return 202 because spawning is async.
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-1", title: "Pending Task", status: "pending", level: "task" },
      ]), null, 2),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.runId).toBeDefined();
    expect(body.taskId).toBe("task-1");
    expect(body.taskTitle).toBe("Pending Task");
    expect(body.status).toBe("started");
  });

  it("accepts blocked task and returns 202", async () => {
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-blocked", title: "Blocked Task", status: "blocked", level: "task" },
      ]), null, 2),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-blocked" }),
    });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.taskId).toBe("task-blocked");
    expect(body.status).toBe("started");
  });
});
