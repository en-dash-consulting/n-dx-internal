import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dirname, "../../cli.js");

function run(args) {
  return execFileSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 10000,
    stdio: "pipe",
  });
}

function runFail(args) {
  try {
    execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: "pipe",
    });
    throw new Error("Expected command to fail");
  } catch (err) {
    if (err.message === "Expected command to fail") throw err;
    return { stderr: err.stderr, stdout: err.stdout };
  }
}

describe("n-dx delegation commands", () => {
  describe("sourcevision", () => {
    it("delegates 'sourcevision --help' to sourcevision CLI", () => {
      const output = run(["sourcevision", "--help"]);
      expect(output).toContain("sourcevision — codebase analysis tool");
      expect(output).toContain("sourcevision analyze");
      expect(output).toContain("sourcevision init");
    });

    it("delegates 'sourcevision' with unknown command shows help hint", () => {
      const { stderr } = runFail(["sourcevision", "--unknown"]);
      expect(stderr).toContain("Unknown");
    });
  });

  describe("sv alias", () => {
    it("delegates 'sv --help' to sourcevision CLI", () => {
      const output = run(["sv", "--help"]);
      expect(output).toContain("sourcevision — codebase analysis tool");
      expect(output).toContain("sourcevision analyze");
    });

    it("sv produces identical output to sourcevision", () => {
      const svOutput = run(["sv", "--help"]);
      const svOutput2 = run(["sourcevision", "--help"]);
      expect(svOutput).toBe(svOutput2);
    });

    it("sv with unknown command shows help hint", () => {
      const { stderr } = runFail(["sv", "--unknown"]);
      expect(stderr).toContain("Unknown");
    });
  });

  describe("rex", () => {
    it("delegates 'rex --help' to rex CLI", () => {
      const output = run(["rex", "--help"]);
      expect(output).toContain("rex");
      expect(output).toContain("PRD management");
      expect(output).toContain("status [dir]");
      expect(output).toContain("add <level>");
    });
  });

  describe("hench", () => {
    it("delegates 'hench --help' to hench CLI", () => {
      const output = run(["hench", "--help"]);
      expect(output).toContain("hench");
      expect(output).toContain("autonomous");
      expect(output).toContain("run [dir]");
      expect(output).toContain("status [dir]");
    });
  });

  describe("help output", () => {
    it("lists sv as an alias for sourcevision", () => {
      const output = run([]);
      expect(output).toContain("sv ...");
      expect(output).toContain("Alias for sourcevision");
    });
  });
});
