import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "dist",
  "cli",
  "index.js",
);

function run(args: string[]): string {
  return execFileSync("node", [cliPath, ...args], {
    encoding: "utf-8",
    timeout: 10000,
  });
}

describe("rex init", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-init-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .rex/ with all files", async () => {
    const output = run(["init", tmpDir]);
    expect(output).toContain("Initialized .rex/");

    const rexDir = join(tmpDir, ".rex");
    await access(join(rexDir, "config.json"));
    await access(join(rexDir, "prd.json"));
    await access(join(rexDir, "execution-log.jsonl"));
    await access(join(rexDir, "workflow.md"));
  });

  it("creates valid config.json", async () => {
    run(["init", tmpDir]);
    const config = JSON.parse(
      await readFile(join(tmpDir, ".rex", "config.json"), "utf-8"),
    );
    expect(config.schema).toBe("rex/v1");
    expect(config.adapter).toBe("file");
    expect(typeof config.project).toBe("string");
  });

  it("creates valid prd.json", async () => {
    run(["init", tmpDir]);
    const doc = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );
    expect(doc.schema).toBe("rex/v1");
    expect(doc.items).toEqual([]);
  });

  it("creates workflow.md with content", async () => {
    run(["init", tmpDir]);
    const workflow = await readFile(
      join(tmpDir, ".rex", "workflow.md"),
      "utf-8",
    );
    expect(workflow).toContain("get_next_task");
  });

  it("is idempotent on re-run", async () => {
    run(["init", tmpDir]);
    const output = run(["init", tmpDir]);
    expect(output).toContain("already exists");

    // Files should still be valid
    const doc = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );
    expect(doc.schema).toBe("rex/v1");
  });
});
