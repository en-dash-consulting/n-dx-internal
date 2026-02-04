import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");

describe("hench init", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "hench-e2e-init-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates .hench/ directory with config and runs", () => {
    const output = execSync(`node ${CLI_PATH} init ${testDir}`, {
      encoding: "utf-8",
    });

    expect(output).toContain("Initialized .hench/");
    expect(output).toContain("config.json");
  });

  it("creates valid config.json", async () => {
    execSync(`node ${CLI_PATH} init ${testDir}`, { encoding: "utf-8" });

    const configPath = join(testDir, ".hench", "config.json");
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);

    expect(config.schema).toBe("hench/v1");
    expect(config.model).toBe("sonnet");
    expect(config.provider).toBe("cli");
    expect(config.maxTurns).toBe(50);
    expect(config.guard.blockedPaths).toContain(".hench/**");
  });

  it("creates runs/ directory", async () => {
    execSync(`node ${CLI_PATH} init ${testDir}`, { encoding: "utf-8" });
    await access(join(testDir, ".hench", "runs"));
  });

  it("is idempotent", () => {
    execSync(`node ${CLI_PATH} init ${testDir}`, { encoding: "utf-8" });
    const output = execSync(`node ${CLI_PATH} init ${testDir}`, {
      encoding: "utf-8",
    });
    expect(output).toContain("already initialized");
  });
});
