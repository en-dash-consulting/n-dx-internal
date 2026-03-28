import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "../../src/server/types.js";
import { handleSourcevisionRoute } from "../../src/server/routes-sourcevision.js";

/**
 * PR markdown endpoint migration tests.
 *
 * The /api/sv/pr-markdown and /api/sv/pr-markdown/state endpoints have been
 * removed and replaced by the /pr-description Claude Code skill.
 * These tests verify the 410 Gone responses direct users to the skill.
 */

describe("PR markdown endpoint migration", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-pr-refresh-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function simulateRequest(method: string, path: string, ctx: ServerContext): {
    handled: boolean;
    status: number;
    body: string;
    headers: Map<string, string>;
  } {
    const req = { method, url: path } as IncomingMessage;
    let status = 200;
    const headers = new Map<string, string>();
    let body = "";
    const res = {
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      writeHead(nextStatus: number, nextHeaders?: Record<string, string>) {
        status = nextStatus;
        if (nextHeaders) {
          for (const [name, value] of Object.entries(nextHeaders)) headers.set(name, value);
        }
        return this;
      },
      end(chunk?: string | Buffer) {
        body = chunk == null ? "" : chunk.toString();
        return this;
      },
    } as unknown as ServerResponse;

    const handled = handleSourcevisionRoute(req, res, ctx);
    return { handled, status, body, headers };
  }

  it("GET /api/sv/pr-markdown returns 410 with migration message", async () => {
    const ctx: ServerContext = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const result = simulateRequest("GET", "/api/sv/pr-markdown", ctx);

    expect(result.handled).toBe(true);
    expect(result.status).toBe(410);
    const data = JSON.parse(result.body);
    expect(data.error).toContain("removed");
    expect(data.message).toContain("/pr-description");
  });

  it("GET /api/sv/pr-markdown/state returns 410 with migration message", async () => {
    const ctx: ServerContext = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const result = simulateRequest("GET", "/api/sv/pr-markdown/state", ctx);

    expect(result.handled).toBe(true);
    expect(result.status).toBe(410);
    const data = JSON.parse(result.body);
    expect(data.error).toContain("removed");
    expect(data.message).toContain("/pr-description");
  });

  it("POST /api/sv/pr-markdown/refresh returns 404 (not handled)", async () => {
    const ctx: ServerContext = { projectDir: tmpDir, svDir, rexDir, dev: false };
    // POST is not a valid method, route handler returns false
    const result = simulateRequest("POST", "/api/sv/pr-markdown/refresh", ctx);
    expect(result.handled).toBe(false);
  });

  it("other sourcevision routes are unaffected", async () => {
    await writeFile(join(svDir, "manifest.json"), JSON.stringify({
      schema: "sourcevision/v1",
      project: "test",
    }));

    const ctx: ServerContext = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const result = simulateRequest("GET", "/api/sv/manifest", ctx);

    expect(result.handled).toBe(true);
    expect(result.status).toBe(200);
    const data = JSON.parse(result.body);
    expect(data.project).toBe("test");
  });
});
