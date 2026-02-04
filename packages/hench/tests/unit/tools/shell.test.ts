import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GuardRails } from "../../../src/guard/index.js";
import { toolRunCommand } from "../../../src/tools/shell.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";

describe("toolRunCommand", () => {
  let projectDir: string;
  let guard: GuardRails;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-shell-"));
    guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("runs allowed commands", async () => {
    const result = await toolRunCommand(guard, projectDir, {
      command: "node -e \"console.log('hello')\"",
    });
    expect(result).toContain("hello");
  });

  it("rejects disallowed commands", async () => {
    await expect(
      toolRunCommand(guard, projectDir, {
        command: "curl http://example.com",
      }),
    ).rejects.toThrow("not in allowlist");
  });

  it("handles command timeout", async () => {
    const result = await toolRunCommand(guard, projectDir, {
      command: "node -e \"setTimeout(() => {}, 60000)\"",
      timeout: 500,
    });
    expect(result).toContain("timed out");
  });

  it("captures stderr", async () => {
    const result = await toolRunCommand(guard, projectDir, {
      command: "node -e \"console.error('oops')\"",
    });
    expect(result).toContain("oops");
  });

  it("rejects chained commands", async () => {
    await expect(
      toolRunCommand(guard, projectDir, {
        command: "npm test && rm -rf /",
      }),
    ).rejects.toThrow("shell operator");
  });
});
