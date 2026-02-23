import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, appendFile, utimes, chmod, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
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

function expectedStructuredDiagnosticCode(code: string): string {
  if (code === "not_repo") return "NOT_A_REPO";
  if (code === "unresolved_main_or_origin_main") return "MISSING_BASE_REF";
  if (code === "auth_fetch_denied") return "FETCH_DENIED";
  if (code === "network_dns_error") return "NETWORK_DNS_ERROR";
  return code;
}

function isClassifiedPreflightCode(code: string): boolean {
  return code === "NOT_A_REPO"
    || code === "MISSING_BASE_REF"
    || code === "FETCH_DENIED"
    || code === "NETWORK_DNS_ERROR"
    || code === "DETACHED_HEAD"
    || code === "SHALLOW_CLONE";
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

  it("GET /api/sv/pr-markdown returns markdown when present", async () => {
    await writeFile(join(svDir, "pr-markdown.md"), "## PR Summary\n\n- Added tab");
    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(200);
    const data = await res.json() as {
      markdown?: string | null;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
    };
    expect(data.markdown).toBe("## PR Summary\n\n- Added tab");
    expect(data.mode).toBe("normal");
    expect("confidence" in data).toBe(false);
    expect("coverage" in data).toBe(false);
  });

  it("GET /api/sv/pr-markdown returns cached fallback metadata when artifact payload is fallback", async () => {
    await writeFile(join(svDir, "pr-markdown.md"), "## Fallback Summary\n\n- Generated in artifact fallback mode");
    await writeFile(
      join(svDir, "pr-markdown.artifact.json"),
      JSON.stringify({
        markdown: "## Fallback Summary\n\n- Generated in artifact fallback mode",
        mode: "fallback",
        confidence: 85,
        coverage: 57,
      }),
    );

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(200);
    const data = await res.json() as {
      markdown?: string | null;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
    };
    expect(data.markdown).toContain("Generated in artifact fallback mode");
    expect(data.mode).toBe("fallback");
    expect(data.coverage).toBe(57);
    expect(data.confidence).toBe(85);
  });

  it("GET /api/sv/pr-markdown reports unsupported when git executable is missing", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.availability).toBe("unsupported");
      expect(data.message).toContain("Git is not available");
      expect(data.markdown).toBeNull();
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("GET /api/sv/pr-markdown reports no-repo state outside git repository", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.availability).toBe("no-repo");
    expect(data.message).toContain("not a git repository");
    expect(data.markdown).toBeNull();
  });

  it("GET /api/sv/pr-markdown does not regenerate markdown when git diff changes", async () => {
    execSync("git init -b main", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });

    await writeFile(join(tmpDir, "alpha.txt"), "one\n");
    await writeFile(join(tmpDir, "beta.txt"), "start\n");
    execSync("git add alpha.txt beta.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });

    execSync("git checkout -b feature/pr-md", { cwd: tmpDir, stdio: "ignore" });
    await appendFile(join(tmpDir, "alpha.txt"), "two\nthree\n");
    await writeFile(join(tmpDir, "zeta.txt"), "new\n");
    execSync("git add alpha.txt zeta.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'feature change'", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(svDir, "pr-markdown.md"), "## Snapshot v1\n\n- `alpha.txt`");

    const firstRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(firstRes.status).toBe(200);
    const first = await firstRes.json();
    expect(first.markdown).toContain("Snapshot v1");

    await writeFile(join(tmpDir, "late.txt"), "later\n");
    execSync("git add late.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'later change'", { cwd: tmpDir, stdio: "ignore" });
    await appendFile(join(tmpDir, "alpha.txt"), "dirty\n");
    await writeFile(join(tmpDir, "scratch.tmp"), "temp\n");

    const secondRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    const second = await secondRes.json();
    expect(second.markdown).toBe(first.markdown);
  });

  it("GET /api/sv/pr-markdown/state returns a signature payload", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/state`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("signature");
    expect(typeof data.signature).toBe("string");
    expect(data.cacheStatus).toBe("missing");
    expect(typeof data.staleAfterMs).toBe("number");
  });

  it("GET /api/sv/pr-markdown/state marks cache stale when artifact is older than threshold", async () => {
    execSync("git init -b main", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(tmpDir, "tracked.txt"), "one\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: tmpDir, stdio: "ignore" });

    const markdownPath = join(svDir, "pr-markdown.md");
    await writeFile(markdownPath, "## stale snapshot");
    const staleDate = new Date(Date.now() - (31 * 60 * 1000));
    await utimes(markdownPath, staleDate, staleDate);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/state`);
    const data = await res.json();
    expect(data.cacheStatus).toBe("stale");
    expect(typeof data.generatedAt).toBe("string");
  });

  it("GET /api/sv/pr-markdown returns warning with partial metadata when base branch is unresolved", async () => {
    execSync("git init -b trunk", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(tmpDir, "only.txt"), "content\n");
    execSync("git add only.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: tmpDir, stdio: "ignore" });

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.availability).toBe("ready");
    expect(data.warning).toContain("Could not resolve base branch");
    expect(data.baseRange).toBeNull();
    expect(data.gitStatusSignature).toBeNull();
  });

  it("GET /api/sv/pr-markdown keeps cached markdown when base branch cannot be resolved", async () => {
    execSync("git init -b trunk", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(tmpDir, "only.txt"), "content\n");
    execSync("git add only.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(svDir, "pr-markdown.md"), "## Existing Summary\n\n- fallback");

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const markdown = String(data.markdown ?? "");
    expect(markdown).toContain("## Existing Summary");
  });

  it.each([
    {
      message: "Error: Git is not available on PATH.",
      code: "missing_git",
    },
    {
      message: "Error: This directory is not a git repository.",
      code: "not_repo",
    },
    {
      message: "Error: Could not resolve a base branch (`main` or `origin/main`).",
      code: "unresolved_main_or_origin_main",
    },
    {
      message: "FETCH_DENIED: Remote 'origin' rejected authentication/authorization for 'main'.",
      code: "auth_fetch_denied",
    },
    {
      message: "NETWORK_DNS_ERROR: Could not reach remote 'origin' while checking 'main'.",
      code: "network_dns_error",
    },
    {
      message: "Error: Failed to fetch origin/main from remote.",
      code: "fetch_failed",
    },
    {
      message: "Error: git rev-parse failed while resolving origin/main.",
      code: "rev_parse_failed",
    },
    {
      message: "Error: Failed to compute git diff for 'main...HEAD'.",
      code: "diff_failed",
    },
  ])("POST /api/sv/pr-markdown/refresh returns degraded fallback payload for $code failures without cache", async ({ message, code }) => {
    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat >&2 <<'EOF'
${message}
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as {
      ok?: boolean;
      status?: string;
      markdown?: string | null;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
      diagnostics?: Array<{
        code?: string;
        summary?: string;
        remediationCommands?: string[];
        message?: string;
        hints?: string[];
        guidance?: { category?: string; commands?: string[] };
      }>;
    };
    expect(data.ok).toBe(false);
    expect(data.status).toBe("degraded");
    expect(data.mode).toBe("fallback");
    expect(data.coverage).toBe(57);
    expect(data.confidence).toBe(85);
    expect(data.markdown).toContain("Generated in artifact fallback mode");
    expect(Array.isArray(data.diagnostics)).toBe(true);
    const structuredCode = expectedStructuredDiagnosticCode(code);
    expect(data.diagnostics?.[0]?.code).toBe(structuredCode);
    if (isClassifiedPreflightCode(structuredCode)) {
      expect(data.diagnostics?.[0]?.message).toBeUndefined();
    } else {
      expect(data.diagnostics?.[0]?.message).toContain(message.replace("Error: ", ""));
    }
    expect(data.diagnostics?.[0]?.hints?.length ?? 0).toBeGreaterThan(0);
    if (["not_repo", "unresolved_main_or_origin_main", "auth_fetch_denied", "network_dns_error"].includes(code)) {
      expect(data.diagnostics?.[0]?.summary?.length ?? 0).toBeGreaterThan(0);
      expect(data.diagnostics?.[0]?.remediationCommands?.length ?? 0).toBeGreaterThan(0);
    }
    const guidanceCategory = data.diagnostics?.[0]?.guidance?.category;
    if (code === "auth_fetch_denied" || code === "network_dns_error" || code === "fetch_failed") {
      expect(guidanceCategory).toBe("fetch_retry");
      expect(data.diagnostics?.[0]?.guidance?.commands).toContain("git fetch origin main");
    } else if (code === "rev_parse_failed" || code === "diff_failed" || code === "unresolved_main_or_origin_main") {
      expect(guidanceCategory).toBe("local_history_remediation");
      expect(data.diagnostics?.[0]?.guidance?.commands).toContain("git diff main...HEAD --name-status");
    } else {
      expect(guidanceCategory).toBe("environment_fix");
    }
    if (code === "unresolved_main_or_origin_main") {
      expect((data.diagnostics?.[0]?.hints ?? []).join("\n")).toContain("main");
      expect((data.diagnostics?.[0]?.hints ?? []).join("\n")).toContain("origin/main");
    }
    if (code === "auth_fetch_denied") {
      expect((data.diagnostics?.[0]?.hints ?? []).join("\n")).toContain("sourcevision git-credential-helper");
    }

    const cachedPayload = JSON.parse(await readFile(join(svDir, "pr-markdown.artifact.json"), "utf-8")) as {
      markdown?: string;
      mode?: string;
      confidence?: number;
      coverage?: number;
    };
    expect(cachedPayload.mode).toBe("fallback");
    expect(cachedPayload.coverage).toBe(57);
    expect(cachedPayload.confidence).toBe(85);
    expect(cachedPayload.markdown).toContain("Generated in artifact fallback mode");
  });

  it("POST /api/sv/pr-markdown/refresh includes Hench run identifiers and task associations in fallback markdown", async () => {
    const runsDir = join(tmpDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "run-1.json"), JSON.stringify({
      id: "run-1",
      taskId: "task-123",
      taskTitle: "Implement fallback parser",
      status: "completed",
      startedAt: "2026-02-22T10:00:00.000Z",
    }));
    await writeFile(join(runsDir, "run-2.json"), JSON.stringify({
      // Missing id/taskTitle by design; parser should fall back to filename id and still render.
      taskId: "task-456",
      status: "failed",
      startedAt: "2026-02-23T10:00:00.000Z",
    }));
    await writeFile(join(runsDir, "corrupt.json"), "{ not-json");

    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat >&2 <<'EOF'
Error: Failed to compute git diff for 'main...HEAD'.
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as { status?: string; markdown?: string | null };
    const markdown = String(data.markdown ?? "");
    expect(data.status).toBe("degraded");
    expect(markdown).toContain("## Hench Execution Context");
    expect(markdown).toContain("Mode: **FALLBACK** (artifact-based; git diff unavailable).");
    expect(markdown).toContain("Evidence sources used: SourceVision artifacts, Hench.");
    expect(markdown).toContain("Run `run-1` (task `task-123`, \"Implement fallback parser\"), outcome: completed, started 2026-02-22T10:00:00.000Z.");
    expect(markdown).toContain("Run `run-2` (task `task-456`), outcome: failed, started 2026-02-23T10:00:00.000Z.");
  });

  it("POST /api/sv/pr-markdown/refresh includes deterministic fallback coverage and confidence metrics", async () => {
    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat >&2 <<'EOF'
Error: Failed to compute git diff for 'main...HEAD'.
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const firstRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    const first = await firstRes.json() as {
      status?: string;
      markdown?: string | null;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
    };
    const secondRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    const second = await secondRes.json() as { status?: string; markdown?: string | null };
    const firstMarkdown = String(first.markdown ?? "");
    const secondMarkdown = String(second.markdown ?? "");

    expect(first.status).toBe("degraded");
    expect(first.mode).toBe("fallback");
    expect(first.coverage).toBe(57);
    expect(first.confidence).toBe(85);
    expect(firstMarkdown).toContain("Mode: **FALLBACK** (artifact-based; git diff unavailable).");
    expect(firstMarkdown).toContain("Evidence sources used: SourceVision artifacts.");
    expect(firstMarkdown).toContain("## Fallback Evidence Metrics");
    expect(firstMarkdown).toContain("Evidence coverage: 57% (4/7 expected sources).");
    expect(firstMarkdown).toContain("Fallback confidence: 85/100.");
    expect(firstMarkdown).toContain("Found evidence sources: SourceVision manifest, SourceVision inventory, SourceVision zones, SourceVision components.");
    expect(firstMarkdown).toContain("Missing required inputs: none.");
    expect(secondMarkdown).toContain("Evidence coverage: 57% (4/7 expected sources).");
    expect(secondMarkdown).toContain("Fallback confidence: 85/100.");
    expect(secondMarkdown).toContain("Found evidence sources: SourceVision manifest, SourceVision inventory, SourceVision zones, SourceVision components.");
  });

  it("POST /api/sv/pr-markdown/refresh lowers confidence when required fallback inputs are missing", async () => {
    await rm(join(svDir, "manifest.json"), { force: true });
    await rm(join(svDir, "inventory.json"), { force: true });

    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat >&2 <<'EOF'
Error: Failed to compute git diff for 'main...HEAD'.
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as {
      status?: string;
      markdown?: string | null;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
    };
    const markdown = String(data.markdown ?? "");
    expect(data.status).toBe("degraded");
    expect(data.mode).toBe("fallback");
    expect(data.coverage).toBe(29);
    expect(data.confidence).toBe(15);
    expect(markdown).toContain("Evidence coverage: 29% (2/7 expected sources).");
    expect(markdown).toContain("Fallback confidence: 15/100.");
    expect(markdown).toContain("Missing required inputs: SourceVision manifest, SourceVision inventory.");
  });

  it("POST /api/sv/pr-markdown/refresh boosts confidence when both Rex and Hench evidence are present", async () => {
    execSync("git init -b main", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(tmpDir, "tracked.txt"), "base\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });
    execSync("git checkout -b feature/current", { cwd: tmpDir, stdio: "ignore" });

    await writeFile(join(rexDir, "prd.json"), JSON.stringify({
      schema: "rex/v1",
      items: [
        {
          id: "epic-123",
          title: "Epic 123",
          level: "epic",
          status: "in_progress",
          children: [
            {
              id: "feature-123",
              title: "Feature 123",
              level: "feature",
              status: "in_progress",
              children: [
                {
                  id: "task-123",
                  title: "Task 123",
                  level: "task",
                  status: "completed",
                  completedAt: "2026-02-23T10:05:00.000Z",
                },
              ],
            },
          ],
        },
      ],
    }));
    await writeFile(
      join(rexDir, "execution-log.jsonl"),
      `${JSON.stringify({ timestamp: "2026-02-23T10:06:00.000Z", itemId: "task-123", branch: "feature/current" })}\n`,
    );
    const runsDir = join(tmpDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "run-1.json"), JSON.stringify({
      id: "run-1",
      taskId: "task-123",
      status: "completed",
      startedAt: "2026-02-23T10:00:00.000Z",
    }));

    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat >&2 <<'EOF'
Error: Failed to compute git diff for 'main...HEAD'.
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as {
      status?: string;
      markdown?: string | null;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
    };
    const markdown = String(data.markdown ?? "");
    expect(data.status).toBe("degraded");
    expect(data.mode).toBe("fallback");
    expect(data.coverage).toBe(86);
    expect(data.confidence).toBe(100);
    expect(markdown).toContain("Mode: **FALLBACK** (artifact-based; git diff unavailable).");
    expect(markdown).toContain("Evidence sources used: SourceVision artifacts, Rex, Hench.");
    expect(markdown).toContain("Evidence coverage: 86% (6/7 expected sources).");
    expect(markdown).toContain("Fallback confidence: 100/100.");
    expect(markdown).toContain("Rex evidence available: yes.");
    expect(markdown).toContain("Found evidence sources: SourceVision manifest, SourceVision inventory, SourceVision zones, SourceVision components, Rex task evidence, Hench run evidence.");
  });

  it("POST /api/sv/pr-markdown/refresh is deterministic from branch-scoped Rex/Hench evidence when SourceVision artifacts are missing", async () => {
    await rm(join(svDir, "manifest.json"), { force: true });
    await rm(join(svDir, "inventory.json"), { force: true });
    await rm(join(svDir, "zones.json"), { force: true });
    await rm(join(svDir, "components.json"), { force: true });

    execSync("git init -b main", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(tmpDir, "tracked.txt"), "base\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });
    execSync("git checkout -b feature/evidence-only", { cwd: tmpDir, stdio: "ignore" });

    await writeFile(join(rexDir, "prd.json"), JSON.stringify({
      schema: "rex/v1",
      items: [
        {
          id: "epic-evidence",
          title: "Evidence Epic",
          level: "epic",
          status: "in_progress",
          children: [
            {
              id: "task-evidence",
              title: "Evidence Task",
              level: "task",
              status: "completed",
              completedAt: "2026-02-23T12:00:00.000Z",
            },
          ],
        },
      ],
    }));
    await writeFile(
      join(rexDir, "execution-log.jsonl"),
      `${JSON.stringify({ timestamp: "2026-02-23T12:01:00.000Z", itemId: "task-evidence", branch: "feature/evidence-only" })}\n`,
    );

    const runsDir = join(tmpDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "run-evidence.json"), JSON.stringify({
      id: "run-evidence",
      taskId: "task-evidence",
      status: "completed",
      startedAt: "2026-02-23T12:02:00.000Z",
    }));

    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat >&2 <<'EOF'
Error: Failed to compute git diff for 'main...HEAD'.
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const firstRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    const first = await firstRes.json() as {
      status?: string;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
      markdown?: string | null;
    };
    const secondRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    const second = await secondRes.json() as {
      status?: string;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
      markdown?: string | null;
    };

    expect(first.status).toBe("degraded");
    expect(first.mode).toBe("fallback");
    expect(first.coverage).toBe(29);
    expect(first.confidence).toBe(25);
    expect(first.markdown).toContain("## Rex Branch Work Context");
    expect(first.markdown).toContain("## Hench Execution Context");

    expect(second.status).toBe("degraded");
    expect(second.mode).toBe("fallback");
    expect(second.coverage).toBe(29);
    expect(second.confidence).toBe(25);
    expect(second.markdown).toBe(first.markdown);
  });

  it("POST /api/sv/pr-markdown/refresh collects branch-scoped Rex items without cross-branch leakage", async () => {
    execSync("git init -b main", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(tmpDir, "tracked.txt"), "base\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });
    execSync("git checkout -b feature/current", { cwd: tmpDir, stdio: "ignore" });

    await writeFile(join(rexDir, "prd.json"), JSON.stringify({
      schema: "rex/v1",
      items: [
        {
          id: "epic-active",
          title: "Active Epic",
          level: "epic",
          status: "in_progress",
          children: [
            {
              id: "feature-active",
              title: "Active Feature",
              level: "feature",
              status: "completed",
              completedAt: "2026-02-22T18:00:00.000Z",
              children: [
                {
                  id: "task-active",
                  title: "Active Task",
                  level: "task",
                  status: "completed",
                  completedAt: "2026-02-22T19:00:00.000Z",
                },
                {
                  id: "task-failed",
                  title: "Failed Task",
                  level: "task",
                  status: "completed",
                  completedAt: "2026-02-22T19:10:00.000Z",
                },
                {
                  id: "task-no-run",
                  title: "No Run Task",
                  level: "task",
                  status: "completed",
                  completedAt: "2026-02-22T19:20:00.000Z",
                },
                {
                  id: "task-deleted",
                  title: "Deleted Task",
                  level: "task",
                  status: "deleted",
                },
              ],
            },
          ],
        },
        {
          id: "epic-other",
          title: "Other Epic",
          level: "epic",
          status: "in_progress",
          children: [
            {
              id: "feature-other",
              title: "Other Feature",
              level: "feature",
              status: "in_progress",
              children: [
                {
                  id: "task-other",
                  title: "Other Task",
                  level: "task",
                  status: "completed",
                  completedAt: "2026-02-20T12:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
    }));
    await writeFile(
      join(rexDir, "execution-log.jsonl"),
      [
        JSON.stringify({ timestamp: "2026-02-23T09:00:00.000Z", itemId: "task-active", branch: "feature/current" }),
        JSON.stringify({ timestamp: "2026-02-23T09:01:00.000Z", itemId: "task-failed", branch: "feature/current" }),
        JSON.stringify({ timestamp: "2026-02-23T09:02:00.000Z", itemId: "task-no-run", branch: "feature/current" }),
        JSON.stringify({ timestamp: "2026-02-23T09:05:00.000Z", itemId: "task-deleted", branchName: "feature/current" }),
        JSON.stringify({ timestamp: "2026-02-23T09:10:00.000Z", itemId: "task-other", context: { branch: "feature/other" } }),
      ].join("\n") + "\n",
    );
    const runsDir = join(tmpDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "run-success.json"), JSON.stringify({
      id: "run-success",
      taskId: "task-active",
      status: "completed",
      startedAt: "2026-02-23T09:30:00.000Z",
      finishedAt: "2026-02-23T09:31:00.000Z",
    }));
    await writeFile(join(runsDir, "run-failure.json"), JSON.stringify({
      id: "run-failure",
      taskId: "task-failed",
      status: "failed",
      startedAt: "2026-02-23T09:40:00.000Z",
      finishedAt: "2026-02-23T09:41:00.000Z",
    }));

    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat >&2 <<'EOF'
Error: Failed to compute git diff for 'main...HEAD'.
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as { status?: string; markdown?: string | null };
    const markdown = String(data.markdown ?? "");
    expect(data.status).toBe("degraded");
    expect(markdown).toContain("## Rex Branch Work Context");
    expect(markdown).toContain("EPIC `epic-active` \"Active Epic\" (status: in_progress).");
    expect(markdown).toContain("FEATURE `feature-active` \"Active Feature\" (status: completed, completedAt: 2026-02-22T18:00:00.000Z).");
    expect(markdown).toContain("TASK `task-active` \"Active Task\" (status: completed, completedAt: 2026-02-22T19:00:00.000Z). [run: success @ 2026-02-23T09:31:00.000Z]");
    expect(markdown).toContain("TASK `task-failed` \"Failed Task\" (status: completed, completedAt: 2026-02-22T19:10:00.000Z). [run: failure @ 2026-02-23T09:41:00.000Z]");
    expect(markdown).toContain("TASK `task-no-run` \"No Run Task\" (status: completed, completedAt: 2026-02-22T19:20:00.000Z). [run: no run evidence]");
    expect(markdown).not.toContain("Deleted Task");
    expect(markdown).not.toContain("epic-other");
    expect(markdown).not.toContain("feature-other");
    expect(markdown).not.toContain("task-other");
  });

  it("POST /api/sv/pr-markdown/refresh omits Hench execution section when no valid run artifacts are present", async () => {
    const runsDir = join(tmpDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "broken.json"), "{ not-json");
    await writeFile(join(runsDir, "array.json"), JSON.stringify(["unexpected-shape"]));

    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat >&2 <<'EOF'
Error: Failed to compute git diff for 'main...HEAD'.
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as { status?: string; markdown?: string | null };
    const markdown = String(data.markdown ?? "");
    expect(data.status).toBe("degraded");
    expect(markdown).not.toContain("## Hench Execution Context");
  });

  it.each([
    {
      message: "Error: Git is not available on PATH.",
      code: "missing_git",
    },
    {
      message: "Error: This directory is not a git repository.",
      code: "not_repo",
    },
    {
      message: "Error: Could not resolve a base branch (`main` or `origin/main`).",
      code: "unresolved_main_or_origin_main",
    },
    {
      message: "FETCH_DENIED: Remote 'origin' rejected authentication/authorization for 'main'.",
      code: "auth_fetch_denied",
    },
    {
      message: "NETWORK_DNS_ERROR: Could not reach remote 'origin' while checking 'main'.",
      code: "network_dns_error",
    },
    {
      message: "Error: Failed to fetch origin/main from remote.",
      code: "fetch_failed",
    },
    {
      message: "Error: git rev-parse failed while resolving origin/main.",
      code: "rev_parse_failed",
    },
    {
      message: "Error: Failed to compute git diff for 'main...HEAD'.",
      code: "diff_failed",
    },
  ])("POST /api/sv/pr-markdown/refresh returns degraded cached payload for $code failures", async ({ message, code }) => {
    const cachedMarkdown = "## Cached Summary\n\n- Keep this content";
    await writeFile(join(svDir, "pr-markdown.md"), cachedMarkdown);
    const beforeRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    const beforeJson = await beforeRes.json() as { generatedAt?: string | null; cacheStatus?: string };

    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat >&2 <<'EOF'
${message}
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as {
      ok?: boolean;
      status?: string;
      markdown?: string | null;
      generatedAt?: string | null;
      cacheStatus?: string;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
      diagnostics?: Array<{
        code?: string;
        summary?: string;
        remediationCommands?: string[];
        message?: string;
        hints?: string[];
        guidance?: { category?: string; commands?: string[] };
      }>;
    };
    expect(data.ok).toBe(false);
    expect(data.status).toBe("degraded");
    expect(data.mode).toBe("fallback");
    expect(data.coverage).toBe(57);
    expect(data.confidence).toBe(85);
    expect(data.markdown).toBe(cachedMarkdown);
    expect(data.generatedAt).toBe(beforeJson.generatedAt ?? null);
    expect(data.cacheStatus).toBe(beforeJson.cacheStatus);
    expect(Array.isArray(data.diagnostics)).toBe(true);
    const structuredCode = expectedStructuredDiagnosticCode(code);
    expect(data.diagnostics?.[0]?.code).toBe(structuredCode);
    if (isClassifiedPreflightCode(structuredCode)) {
      expect(data.diagnostics?.[0]?.message).toBeUndefined();
    } else {
      expect(data.diagnostics?.[0]?.message).toContain(message.replace("Error: ", ""));
    }
    expect(data.diagnostics?.[0]?.hints?.length ?? 0).toBeGreaterThan(0);
    if (["not_repo", "unresolved_main_or_origin_main", "auth_fetch_denied", "network_dns_error"].includes(code)) {
      expect(data.diagnostics?.[0]?.summary?.length ?? 0).toBeGreaterThan(0);
      expect(data.diagnostics?.[0]?.remediationCommands?.length ?? 0).toBeGreaterThan(0);
    }
    const guidanceCategory = data.diagnostics?.[0]?.guidance?.category;
    if (code === "auth_fetch_denied" || code === "network_dns_error" || code === "fetch_failed") {
      expect(guidanceCategory).toBe("fetch_retry");
      expect(data.diagnostics?.[0]?.guidance?.commands).toContain("git fetch origin main");
    } else if (code === "rev_parse_failed" || code === "diff_failed" || code === "unresolved_main_or_origin_main") {
      expect(guidanceCategory).toBe("local_history_remediation");
      expect(data.diagnostics?.[0]?.guidance?.commands).toContain("git diff main...HEAD --name-status");
    } else {
      expect(guidanceCategory).toBe("environment_fix");
    }
    if (code === "unresolved_main_or_origin_main") {
      expect((data.diagnostics?.[0]?.hints ?? []).join("\n")).toContain("main");
      expect((data.diagnostics?.[0]?.hints ?? []).join("\n")).toContain("origin/main");
    }
    if (code === "auth_fetch_denied") {
      expect((data.diagnostics?.[0]?.hints ?? []).join("\n")).toContain("sourcevision git-credential-helper");
    }

    const cachedPayload = JSON.parse(await readFile(join(svDir, "pr-markdown.artifact.json"), "utf-8")) as {
      markdown?: string;
      mode?: string;
      confidence?: number;
      coverage?: number;
    };
    expect(cachedPayload.mode).toBe("fallback");
    expect(cachedPayload.coverage).toBe(57);
    expect(cachedPayload.confidence).toBe(85);
    expect(cachedPayload.markdown).toBe(cachedMarkdown);
  });

  it("POST /api/sv/pr-markdown/refresh returns detached-head preflight diagnostics with remediation commands", async () => {
    const cachedMarkdown = "## Cached Summary\n\n- Keep this content";
    await writeFile(join(svDir, "pr-markdown.md"), cachedMarkdown);

    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat >&2 <<'EOF'
DETACHED_HEAD: HEAD is detached at commit 1234567.
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as {
      status?: string;
      markdown?: string | null;
      diagnostics?: Array<{
        code?: string;
        summary?: string;
        remediationCommands?: string[];
        message?: string;
      }>;
      failure?: {
        code?: string;
        stage?: string;
        remediationCommands?: string[];
      };
    };
    expect(data.status).toBe("degraded");
    expect(data.markdown).toBe(cachedMarkdown);
    expect(data.diagnostics?.[0]?.code).toBe("DETACHED_HEAD");
    expect(data.diagnostics?.[0]?.summary?.length ?? 0).toBeGreaterThan(0);
    expect(data.diagnostics?.[0]?.remediationCommands).toContain("git switch -c <branch-name>");
    expect(data.diagnostics?.[0]?.message).toBeUndefined();
    expect(data.failure?.code).toBe("DETACHED_HEAD");
    expect(data.failure?.stage).toBe("preflight");
    expect(data.failure?.remediationCommands).toContain("git switch -c <branch-name>");
  });

  it("POST /api/sv/pr-markdown/refresh keeps 500 behavior for non-classified internal failures", async () => {
    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat >&2 <<'EOF'
TypeError: Cannot read properties of undefined (reading 'map')
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(500);
    const data = await res.json() as { error?: string; diagnostics?: unknown };
    expect(data.error).toContain("Failed to regenerate PR markdown");
    expect("diagnostics" in data).toBe(false);
  });

  it("POST /api/sv/pr-markdown/refresh keeps cached artifact unchanged on semantic diff inspection failure", async () => {
    const cachedMarkdown = "## Cached Summary\n\n- Keep this content";
    const cachedPath = join(svDir, "pr-markdown.md");
    await writeFile(cachedPath, cachedMarkdown);
    const beforeRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    const beforeJson = await beforeRes.json() as { generatedAt?: string | null };

    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat > ".sourcevision/pr-markdown.md" <<'EOF'
## PARTIAL
EOF
cat >&2 <<'EOF'
Error: Failed to inspect semantic diff details for 'main...HEAD'.
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as {
      ok?: boolean;
      status?: string;
      markdown?: string | null;
      generatedAt?: string | null;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
      diagnostics?: Array<{ code?: string }>;
      failure?: {
        stage?: string;
        stageStatuses?: {
          nameStatusDiff?: string;
          semanticDiff?: string;
        };
        guidanceCategory?: string;
        commandSuggestions?: string[];
        command?: {
          gitSubcommand?: string;
          subcommand?: string;
          stageId?: string;
          exitCode?: number | null;
          stderr?: string;
          stderrExcerpt?: string;
          reproduce?: string[];
        };
      };
    };
    expect(data.ok).toBe(false);
    expect(data.status).toBe("degraded");
    expect(data.mode).toBe("fallback");
    expect(data.coverage).toBe(57);
    expect(data.confidence).toBe(85);
    expect(data.markdown).toBe(cachedMarkdown);
    expect(data.generatedAt).toBe(beforeJson.generatedAt ?? null);
    expect(data.diagnostics?.[0]?.code).toBe("diff_failed");
    expect(data.failure?.stage).toBe("mixed");
    expect(data.failure?.stageStatuses?.nameStatusDiff).toBe("succeeded");
    expect(data.failure?.stageStatuses?.semanticDiff).toBe("failed");
    expect(data.failure?.guidanceCategory).toBe("local_history_remediation");
    expect(data.failure?.commandSuggestions).toContain("git diff main...HEAD --name-status");
    expect(data.failure?.command?.gitSubcommand).toBe("diff");
    expect(data.failure?.command?.subcommand).toBe("git --no-pager diff --no-ext-diff --no-textconv --numstat main...HEAD");
    expect(data.failure?.command?.stageId).toBe("semantic_diff_numstat");
    expect(data.failure?.command?.exitCode).toBe(1);
    expect(data.failure?.command?.stderrExcerpt).toContain("Failed to inspect semantic diff details");
    expect(Array.isArray(data.failure?.command?.reproduce)).toBe(true);

    const onDisk = await readFile(cachedPath, "utf-8");
    expect(onDisk).toBe(cachedMarkdown);
    const cachedPayload = JSON.parse(await readFile(join(svDir, "pr-markdown.artifact.json"), "utf-8")) as {
      markdown?: string;
      mode?: string;
      confidence?: number;
      coverage?: number;
    };
    expect(cachedPayload.markdown).toBe(cachedMarkdown);
    expect(cachedPayload.mode).toBe("fallback");
    expect(cachedPayload.coverage).toBe(57);
    expect(cachedPayload.confidence).toBe(85);
  });

  it("POST /api/sv/pr-markdown/refresh returns fallback payload and caches fallback artifact metadata on semantic diff inspection failure without cache", async () => {
    const cachedPath = join(svDir, "pr-markdown.md");
    await rm(cachedPath, { force: true });

    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat > ".sourcevision/pr-markdown.md" <<'EOF'
## PARTIAL
EOF
cat >&2 <<'EOF'
Error: Failed to inspect semantic diff details for 'main...HEAD'.
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as {
      status?: string;
      markdown?: string | null;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
      diagnostics?: Array<{ code?: string }>;
      failure?: {
        stage?: string;
        stageStatuses?: {
          nameStatusDiff?: string;
          semanticDiff?: string;
        };
        guidanceCategory?: string;
        commandSuggestions?: string[];
        command?: {
          gitSubcommand?: string;
          subcommand?: string;
          stageId?: string;
          exitCode?: number | null;
        };
      };
    };
    expect(data.status).toBe("degraded");
    expect(data.mode).toBe("fallback");
    expect(data.coverage).toBe(57);
    expect(data.confidence).toBe(85);
    expect(data.markdown).toContain("Generated in artifact fallback mode");
    expect(data.diagnostics?.[0]?.code).toBe("diff_failed");
    expect(data.failure?.stage).toBe("mixed");
    expect(data.failure?.stageStatuses?.nameStatusDiff).toBe("succeeded");
    expect(data.failure?.stageStatuses?.semanticDiff).toBe("failed");
    expect(data.failure?.guidanceCategory).toBe("local_history_remediation");
    expect(data.failure?.commandSuggestions).toContain("git diff main...HEAD --name-status");
    expect(data.failure?.command?.gitSubcommand).toBe("diff");
    expect(data.failure?.command?.subcommand).toBe("git --no-pager diff --no-ext-diff --no-textconv --numstat main...HEAD");
    expect(data.failure?.command?.stageId).toBe("semantic_diff_numstat");
    expect(data.failure?.command?.exitCode).toBe(1);
    expect(existsSync(cachedPath)).toBe(true);
    const cachedMarkdown = await readFile(cachedPath, "utf-8");
    expect(cachedMarkdown).toContain("Generated in artifact fallback mode");
    const cachedPayload = JSON.parse(await readFile(join(svDir, "pr-markdown.artifact.json"), "utf-8")) as {
      markdown?: string;
      mode?: string;
      confidence?: number;
      coverage?: number;
    };
    expect(cachedPayload.mode).toBe("fallback");
    expect(cachedPayload.coverage).toBe(57);
    expect(cachedPayload.confidence).toBe(85);
    expect(cachedPayload.markdown).toContain("Generated in artifact fallback mode");
  });

  it("POST /api/sv/pr-markdown/refresh omits diagnostics on successful refresh", async () => {
    await writeFile(
      join(svDir, "pr-markdown.artifact.json"),
      JSON.stringify({
        markdown: "## stale fallback",
        mode: "fallback",
        confidence: 22,
        coverage: 18,
      }),
    );

    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat > ".sourcevision/pr-markdown.md" <<'EOF'
## Fresh Summary
EOF
exit 0
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as {
      ok?: boolean;
      status?: string;
      markdown?: string | null;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
      diagnostics?: unknown;
    };
    expect(data.ok).toBe(true);
    expect(data.status).toBe("ok");
    expect(data.mode).toBe("normal");
    expect("confidence" in data).toBe(false);
    expect("coverage" in data).toBe(false);
    expect(data.markdown).toContain("## Fresh Summary");
    expect("diagnostics" in data).toBe(false);
    const cachedPayload = JSON.parse(await readFile(join(svDir, "pr-markdown.artifact.json"), "utf-8")) as {
      markdown?: string;
      mode?: string;
      confidence?: number;
      coverage?: number;
    };
    expect(cachedPayload.mode).toBe("normal");
    expect("confidence" in cachedPayload).toBe(false);
    expect("coverage" in cachedPayload).toBe(false);
    expect(cachedPayload.markdown).toContain("## Fresh Summary");
  });

  it("POST /api/sv/pr-markdown/refresh does not invoke credential helper by default", async () => {
    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    const callsPath = join(tmpDir, "sourcevision-calls.log");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
echo "$@" >> "${callsPath}"
if [ "$1" = "pr-markdown" ]; then
  cat > ".sourcevision/pr-markdown.md" <<'EOF'
## Fresh Summary
EOF
  exit 0
fi
if [ "$1" = "git-credential-helper" ]; then
  exit 99
fi
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const calls = await readFile(callsPath, "utf-8");
    expect(calls).toContain("pr-markdown");
    expect(calls).not.toContain("git-credential-helper");
  });

  it("POST /api/sv/pr-markdown/refresh runs credential helper only with explicit opt-in flag", async () => {
    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    const callsPath = join(tmpDir, "sourcevision-calls.log");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
echo "$@" >> "${callsPath}"
if [ "$1" = "git-credential-helper" ]; then
  exit 0
fi
if [ "$1" = "pr-markdown" ]; then
  cat > ".sourcevision/pr-markdown.md" <<'EOF'
## Fresh Summary
EOF
  exit 0
fi
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh?credentialHelper=1`, { method: "POST" });
    expect(res.status).toBe(200);
    const calls = await readFile(callsPath, "utf-8");
    expect(calls).toContain("git-credential-helper");
    expect(calls).toContain("pr-markdown");
  });

  it("PR markdown state signature changes when markdown file changes", async () => {
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(tmpDir, "tracked.txt"), "one\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: tmpDir, stdio: "ignore" });

    const beforeRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown/state`);
    const before = await beforeRes.json();

    await writeFile(join(svDir, "pr-markdown.md"), "## refreshed");

    const afterRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown/state`);
    const after = await afterRes.json();

    expect(before.signature).not.toBe(after.signature);
  });

  it("GET /api/sv/pr-markdown returns null when missing", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.markdown).toBeNull();
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

  it("does not handle POST requests", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/manifest`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});
