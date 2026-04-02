import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer as createNetServer } from "node:net";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");
const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/small-ts-project");

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function waitForServer(port: number, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      fetch(`http://localhost:${port}/`)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - start > timeout) {
            reject(new Error("Server did not start in time"));
          } else {
            setTimeout(check, 100);
          }
        });
    };
    check();
  });
}

/** Kill a process and all its children by PID */
function killTree(pid: number): void {
  try {
    // Kill the entire process group (negative PID)
    process.kill(-pid, "SIGTERM");
  } catch {
    // Process group kill failed — fall back to direct kill
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already dead
    }
  }
}

describe("sourcevision serve (e2e)", () => {
  let tmpDir: string;
  let serverProc: ChildProcess | null = null;

  afterEach(async () => {
    if (serverProc) {
      const proc = serverProc;
      serverProc = null;
      if (proc.pid) killTree(proc.pid);
      // Wait for the process to fully exit so vitest doesn't hang on open handles
      await new Promise<void>((resolve) => {
        proc.on("close", () => resolve());
        setTimeout(() => {
          // Final SIGKILL if still alive
          if (proc.pid) {
            try { process.kill(proc.pid, "SIGKILL"); } catch { /* already dead */ }
          }
          resolve();
        }, 3000);
      });
    }
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("serves viewer and data files", { timeout: 30000 }, async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-serve-"));
    await cp(FIXTURE_DIR, tmpDir, { recursive: true });

    // Analyze first
    execFileSync("node", [CLI_PATH, "analyze", tmpDir, "--fast"], {
      encoding: "utf-8",
      timeout: 30000,
    });

    // Start server on an OS-assigned free port
    // detached: true creates a new process group so we can kill the whole tree
    const port = await getFreePort();
    serverProc = spawn("node", [CLI_PATH, "serve", tmpDir, `--port=${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    await waitForServer(port);

    // Fetch index page
    const htmlRes = await fetch(`http://localhost:${port}/`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html.toLowerCase()).toContain("sourcevision");
    expect(html).toContain("<div id=\"app\"></div>");

    // Fetch data file list
    const dataRes = await fetch(`http://localhost:${port}/data`);
    expect(dataRes.status).toBe(200);
    const dataList = await dataRes.json();
    expect(dataList.files).toContain("manifest.json");
    expect(dataList.files).toContain("inventory.json");

    // Fetch a data file
    const invRes = await fetch(`http://localhost:${port}/data/inventory.json`);
    expect(invRes.status).toBe(200);
    const inv = await invRes.json();
    expect(inv.files).toBeDefined();
    expect(inv.summary).toBeDefined();
  });
});
