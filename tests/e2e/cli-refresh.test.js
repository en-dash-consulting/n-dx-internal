import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dirname, "../../cli.js");

function runRefresh(args, opts = {}) {
  return execFileSync("node", [CLI_PATH, "refresh", ...args], {
    encoding: "utf-8",
    timeout: 60000,
    ...opts,
  });
}

function runRefreshResult(args, opts = {}) {
  try {
    const stdout = runRefresh(args, { stdio: "pipe", ...opts });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      code: err.status ?? 1,
    };
  }
}

describe("n-dx refresh", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-refresh-e2e-"));
    await writeFile(join(tmpDir, "index.js"), "export const ok = true;\n");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("shows supported flags in --help", () => {
    const output = runRefresh(["--help"]);
    expect(output).toContain("ndx refresh");
    expect(output).toContain("--ui-only");
    expect(output).toContain("--data-only");
    expect(output).toContain("--pr-markdown");
    expect(output).toContain("--no-build");
  });

  it("executes from a configured project root without unknown-command errors", () => {
    const { stdout, stderr, code } = runRefreshResult(["--data-only", tmpDir]);
    expect(code).toBe(0);
    expect(stdout).not.toContain("Unknown command");
    expect(stderr).not.toContain("Unknown command");
    expect(stdout).toContain("skipping UI build because --data-only was set");
    expect(stdout).toContain("Refresh step: sourcevision-analyze -> started");
    expect(stdout).toContain("Refresh step: sourcevision-analyze -> succeeded");
    expect(stdout).toContain("Refresh step: sourcevision-dashboard-artifacts -> started");
    expect(stdout).toContain("Refresh step: sourcevision-dashboard-artifacts -> succeeded");
    expect(stdout).toContain("Refresh step: web-build -> skipped (--data-only)");
    expect(stdout).toContain("Refresh step summary:");
    expect(stdout).toContain("web-build: skipped (--data-only)");
  });

  it("updates dashboard artifact metadata after data refresh", async () => {
    const artifactPath = join(tmpDir, ".sourcevision", "dashboard-artifacts.json");

    const first = runRefreshResult(["--data-only", tmpDir]);
    expect(first.code).toBe(0);
    const firstStat = await stat(artifactPath);
    const firstMeta = JSON.parse(await readFile(artifactPath, "utf-8"));
    expect(firstMeta.artifact).toBe("sourcevision-dashboard");
    expect(typeof firstMeta.refreshedAt).toBe("string");
    expect(new Date(firstMeta.refreshedAt).getTime()).not.toBeNaN();

    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = runRefreshResult(["--data-only", tmpDir]);
    expect(second.code).toBe(0);
    const secondStat = await stat(artifactPath);
    const secondMeta = JSON.parse(await readFile(artifactPath, "utf-8"));
    expect(new Date(secondMeta.refreshedAt).getTime()).not.toBeNaN();
    expect(secondStat.mtimeMs).toBeGreaterThanOrEqual(firstStat.mtimeMs);
  });

  it("returns non-zero when a refresh step fails", () => {
    const missingDir = join(tmpDir, "does-not-exist");
    const { code } = runRefreshResult(["--data-only", missingDir]);
    expect(code).not.toBe(0);
  });

  it("rejects conflicting --ui-only and --data-only flags with guidance", () => {
    const { stderr, code } = runRefreshResult(["--ui-only", "--data-only", tmpDir]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("--ui-only and --data-only cannot be used together");
    expect(stderr).toContain("Choose one scope flag");
  });

  it("skips build execution for --no-build and reports it in step summary", () => {
    const { stdout, code } = runRefreshResult(["--no-build", tmpDir]);
    expect(code).toBe(0);
    expect(stdout).toContain("skipping UI build because --no-build was set");
    expect(stdout).toContain("Refresh step summary:");
    expect(stdout).toContain("web-build: skipped (--no-build)");
  });

  it("allows --ui-only --no-build and prints a valid no-build summary", () => {
    const { stdout, code } = runRefreshResult(["--ui-only", "--no-build", tmpDir]);
    expect(code).toBe(0);
    expect(stdout).toContain("Refresh step summary:");
    expect(stdout).toContain("sourcevision-analyze: skipped (--ui-only)");
    expect(stdout).toContain("sourcevision-dashboard-artifacts: skipped (--ui-only)");
    expect(stdout).toContain("web-build: skipped (--no-build)");
  });

  it("attempts and reports successful live-reload signaling when a server supports it", async () => {
    const mockPath = join(tmpDir, "mock-fetch.mjs");
    await writeFile(
      mockPath,
      [
        "globalThis.fetch = async () => new Response(",
        "  JSON.stringify({ ok: true, websocketClients: 2 }),",
        "  { status: 200, headers: { 'content-type': 'application/json' } }",
        ");",
      ].join("\n"),
      "utf-8",
    );

    const port = 3117;
    await writeFile(join(tmpDir, ".n-dx-web.port"), String(port));
    const stdout = execFileSync(
      "node",
      ["--import", mockPath, CLI_PATH, "refresh", "--ui-only", "--no-build", tmpDir],
      { encoding: "utf-8", timeout: 60000 },
    );
    expect(stdout).toContain(`Live reload: attempted on :${port} and succeeded (2 WebSocket clients notified).`);
  });

  it("prints restart-required guidance when live reload signaling is unavailable", async () => {
    const mockPath = join(tmpDir, "mock-fetch-404.mjs");
    await writeFile(
      mockPath,
      "globalThis.fetch = async () => new Response('', { status: 404 });\n",
      "utf-8",
    );

    const port = 3117;
    await writeFile(join(tmpDir, ".n-dx-web.port"), String(port));
    const stdout = execFileSync(
      "node",
      ["--import", mockPath, CLI_PATH, "refresh", "--ui-only", "--no-build", tmpDir],
      { encoding: "utf-8", timeout: 60000 },
    );

    expect(stdout).toContain(`Live reload: unavailable on :${port} (server does not support reload signaling).`);
    expect(stdout).toContain(`Restart required: ndx start stop "${tmpDir}" && ndx start "${tmpDir}"`);
  });

  it("reports skipped live reload when no running server context is detected", () => {
    const { stdout, code } = runRefreshResult(["--ui-only", "--no-build", tmpDir]);
    expect(code).toBe(0);
    expect(stdout).toContain("Live reload: skipped (no running dashboard server detected).");
  });
});
