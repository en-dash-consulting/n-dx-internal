import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleSourcevisionRoute } from "../../../src/server/routes-sourcevision.js";

/** Start a test server that only runs sourcevision routes. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (handleSourcevisionRoute(req, res, ctx)) return;
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

describe("Sourcevision API routes", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  const manifestData = {
    schema: "sourcevision/v1",
    project: "test-project",
    timestamp: "2026-01-01T00:00:00.000Z",
    version: "0.1.0",
    git: { branch: "main", sha: "abc123" },
    summary: { totalFiles: 10, analyzedFiles: 10, languages: { TypeScript: 8, JavaScript: 2 } },
  };

  const inventoryData = {
    schema: "sourcevision/v1",
    files: [
      { path: "src/index.ts", extension: ".ts", sizeBytes: 1024, lines: 50 },
      { path: "src/utils.ts", extension: ".ts", sizeBytes: 512, lines: 25 },
    ],
    summary: { totalFiles: 2, totalLines: 75, totalSizeBytes: 1536 },
  };

  const zonesData = {
    schema: "sourcevision/v1",
    zones: [
      { id: "zone-1", name: "Core", files: ["src/index.ts"] },
      { id: "zone-2", name: "Utils", files: ["src/utils.ts"] },
    ],
  };

  const componentsData = {
    schema: "sourcevision/v1",
    components: [
      { name: "App", file: "src/App.tsx", props: [] },
    ],
  };

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-api-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    // Write fixture data
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(manifestData));
    await writeFile(join(svDir, "inventory.json"), JSON.stringify(inventoryData));
    await writeFile(join(svDir, "zones.json"), JSON.stringify(zonesData));
    await writeFile(join(svDir, "components.json"), JSON.stringify(componentsData));
    await writeFile(join(svDir, "CONTEXT.md"), "# Test Context\n\nThis is a test.");

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/sv/manifest returns manifest data", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/manifest`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project).toBe("test-project");
    expect(data.schema).toBe("sourcevision/v1");
  });

  it("GET /api/sv/inventory returns inventory data", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/inventory`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.files).toHaveLength(2);
    expect(data.summary.totalFiles).toBe(2);
  });

  it("GET /api/sv/zones returns zones data", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/zones`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.zones).toHaveLength(2);
    expect(data.zones[0].name).toBe("Core");
  });

  it("GET /api/sv/components returns components data", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/components`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.components).toHaveLength(1);
    expect(data.components[0].name).toBe("App");
  });

  it("GET /api/sv/context returns CONTEXT.md", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/context`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown");
    const text = await res.text();
    expect(text).toContain("# Test Context");
  });

  it("GET /api/sv/pr-markdown returns 410 Gone (migrated to /pr-description skill)", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(410);
    const data = await res.json();
    expect(data.error).toContain("removed");
    expect(data.message).toContain("/pr-description");
  });

  it("GET /api/sv/pr-markdown/state returns 410 Gone (migrated to /pr-description skill)", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/state`);
    expect(res.status).toBe(410);
    const data = await res.json();
    expect(data.error).toContain("removed");
    expect(data.message).toContain("/pr-description");
  });

  it("GET /api/sv/summary returns aggregate stats", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/summary`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasManifest).toBe(true);
    expect(data.hasInventory).toBe(true);
    expect(data.hasZones).toBe(true);
    expect(data.hasComponents).toBe(true);
    expect(data.project).toBe("test-project");
    expect(data.fileCount).toBe(2);
    expect(data.zoneCount).toBe(2);
    expect(data.componentCount).toBe(1);
  });

  it("returns 404 for missing data files", async () => {
    // Use a fresh dir with no data
    const emptyDir = await mkdtemp(join(tmpdir(), "sv-api-empty-"));
    const emptySvDir = join(emptyDir, ".sourcevision");
    await mkdir(emptySvDir, { recursive: true });
    const emptyCtx: ServerContext = { projectDir: emptyDir, svDir: emptySvDir, rexDir, dev: false };

    const emptyStarted = await startTestServer(emptyCtx);
    try {
      const res = await fetch(`http://localhost:${emptyStarted.port}/api/sv/manifest`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("No manifest data");
    } finally {
      emptyStarted.server.close();
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("does not handle non-sv API paths", async () => {
    const res = await fetch(`http://localhost:${port}/api/other`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe("Not found");
  });

  it("does not handle POST requests to GET-only endpoints", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/manifest`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  // ── db-packages endpoint ─────────────────────────────────────────

  it("GET /api/sv/db-packages returns classified database packages", async () => {
    const importsData = {
      edges: [],
      external: [
        { package: "react", importedBy: ["src/app.ts", "src/index.ts"], symbols: ["useState"] },
        { package: "pg", importedBy: ["src/db.ts", "src/repo.ts", "src/migrate.ts"], symbols: ["Pool", "Client"] },
        { package: "prisma", importedBy: ["src/db.ts", "src/models.ts"], symbols: ["PrismaClient"] },
        { package: "redis", importedBy: ["src/cache.ts"], symbols: ["createClient"] },
        { package: "lodash", importedBy: ["src/utils.ts"], symbols: ["debounce"] },
        { package: "knex", importedBy: ["src/query.ts", "src/db.ts"], symbols: ["knex"] },
      ],
      summary: { totalEdges: 0, totalExternal: 6, circularCount: 0 },
    };
    await writeFile(join(svDir, "imports.json"), JSON.stringify(importsData));

    const res = await fetch(`http://localhost:${port}/api/sv/db-packages`);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Should detect 4 database packages (pg, prisma, redis, knex) and skip react/lodash
    expect(data.totalPackages).toBe(4);
    expect(data.matches).toHaveLength(4);

    // Sorted by importedBy count descending: pg(3), prisma(2), knex(2), redis(1)
    expect(data.matches[0].package).toBe("pg");
    expect(data.matches[0].category).toBe("driver");

    // Categories should be present
    expect(data.categories.length).toBeGreaterThanOrEqual(3); // driver, orm, query-builder, cache
    const driverCat = data.categories.find((c: { category: string }) => c.category === "driver");
    expect(driverCat).toBeDefined();
    expect(driverCat.packageCount).toBe(1);
    expect(driverCat.label).toBe("Driver");

    // Total unique importers
    expect(data.totalImporters).toBeGreaterThan(0);
  });

  it("GET /api/sv/db-packages returns empty when no database packages exist", async () => {
    const importsData = {
      edges: [],
      external: [
        { package: "react", importedBy: ["src/app.ts"], symbols: ["useState"] },
        { package: "lodash", importedBy: ["src/utils.ts"], symbols: ["debounce"] },
      ],
      summary: { totalEdges: 0, totalExternal: 2, circularCount: 0 },
    };
    await writeFile(join(svDir, "imports.json"), JSON.stringify(importsData));

    const res = await fetch(`http://localhost:${port}/api/sv/db-packages`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.totalPackages).toBe(0);
    expect(data.matches).toEqual([]);
    expect(data.categories).toEqual([]);
    expect(data.totalImporters).toBe(0);
  });

  it("GET /api/sv/db-packages returns 404 when imports data is missing", async () => {
    // No imports.json written — should return 404
    const emptyDir = await mkdtemp(join(tmpdir(), "sv-api-noimports-"));
    const emptySvDir = join(emptyDir, ".sourcevision");
    await mkdir(emptySvDir, { recursive: true });
    const emptyCtx: ServerContext = { projectDir: emptyDir, svDir: emptySvDir, rexDir, dev: false };

    const emptyStarted = await startTestServer(emptyCtx);
    try {
      const res = await fetch(`http://localhost:${emptyStarted.port}/api/sv/db-packages`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("No imports data");
    } finally {
      emptyStarted.server.close();
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  // ── phases endpoint (grouped) ───────────────────────────────────

  it("GET /api/sv/phases returns 4 grouped phases with aggregated status", async () => {
    // Write manifest with modules data — inventory+imports complete, classifications running
    const manifestWithModules = {
      ...manifestData,
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
          status: "complete",
          startedAt: "2026-01-01T00:00:03.000Z",
          completedAt: "2026-01-01T00:00:04.000Z",
        },
        classifications: {
          status: "running",
          startedAt: "2026-01-01T00:00:05.000Z",
          pid: process.pid, // Current PID so lock check sees it as alive
        },
      },
    };
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(manifestWithModules));

    const res = await fetch(`http://localhost:${port}/api/sv/phases`);
    expect(res.status).toBe(200);
    const envelope = await res.json();

    expect(envelope).toHaveProperty("phases");
    expect(envelope).toHaveProperty("anyRunning");
    const data = envelope.phases;

    // Should return exactly 4 grouped phases
    expect(data).toHaveLength(4);

    // Group 1 (Scan): all 3 modules complete → group status "complete"
    expect(data[0]).toMatchObject({
      group: 1,
      name: "Scan",
      status: "complete",
    });
    expect(data[0].modules).toHaveLength(3);
    expect(data[0].modules[0]).toMatchObject({ id: "inventory", status: "complete" });
    expect(data[0].modules[1]).toMatchObject({ id: "imports", status: "complete" });
    expect(data[0].modules[2]).toMatchObject({ id: "configsurface", status: "complete" });
    // Timestamps: earliest startedAt, latest completedAt
    expect(data[0].startedAt).toBe("2026-01-01T00:00:01.000Z");
    expect(data[0].completedAt).toBe("2026-01-01T00:00:04.000Z");

    // Group 2 (Classify): classifications running → group status "running"
    expect(data[1]).toMatchObject({
      group: 2,
      name: "Classify",
      status: "running",
    });
    expect(data[1].modules).toHaveLength(2);

    // Group 3 (Architecture): no modules completed → pending
    expect(data[2]).toMatchObject({
      group: 3,
      name: "Architecture",
      status: "pending",
    });

    // Group 4 (Deep Analysis): empty modules → pending
    expect(data[3]).toMatchObject({
      group: 4,
      name: "Deep Analysis",
      status: "pending",
    });
  });

  it("GET /api/sv/phases includes aggregated error from module errors", async () => {
    const manifestWithError = {
      ...manifestData,
      modules: {
        inventory: {
          status: "error",
          startedAt: "2026-01-01T00:00:01.000Z",
          error: "Something went wrong",
        },
      },
    };
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(manifestWithError));

    const res = await fetch(`http://localhost:${port}/api/sv/phases`);
    expect(res.status).toBe(200);
    const envelope = await res.json();
    const data = envelope.phases;

    // Group 1 (Scan) should have error status and include the module error
    expect(data[0].status).toBe("error");
    expect(data[0].error).toContain("Something went wrong");
    expect(data[0].modules[0]).toMatchObject({
      id: "inventory",
      status: "error",
      error: "Something went wrong",
    });
  });

  it("GET /api/sv/phases defaults all groups to pending when manifest has no modules", async () => {
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(manifestData));

    const res = await fetch(`http://localhost:${port}/api/sv/phases`);
    expect(res.status).toBe(200);
    const envelope = await res.json();
    const data = envelope.phases;

    expect(data).toHaveLength(4);
    for (const phase of data) {
      expect(phase.status).toBe("pending");
      expect(phase.startedAt).toBeNull();
      expect(phase.completedAt).toBeNull();
      expect(phase.error).toBeNull();
    }
    expect(envelope.anyRunning).toBe(false);
  });

  it("GET /api/sv/phases returns 4 pending groups when manifest is missing (empty state)", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "sv-api-nophases-"));
    const emptySvDir = join(emptyDir, ".sourcevision");
    await mkdir(emptySvDir, { recursive: true });
    const emptyCtx: ServerContext = { projectDir: emptyDir, svDir: emptySvDir, rexDir, dev: false };

    const emptyStarted = await startTestServer(emptyCtx);
    try {
      const res = await fetch(`http://localhost:${emptyStarted.port}/api/sv/phases`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.anyRunning).toBe(false);
      expect(data.phases).toHaveLength(4);
      for (const phase of data.phases) {
        expect(phase.status).toBe("pending");
      }
    } finally {
      emptyStarted.server.close();
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
