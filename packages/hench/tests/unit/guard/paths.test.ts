import { describe, it, expect } from "vitest";
import { validatePath, simpleGlobMatch, GuardError } from "../../../src/guard/paths.js";

describe("simpleGlobMatch", () => {
  it("matches exact filenames", () => {
    expect(simpleGlobMatch("foo.txt", "foo.txt")).toBe(true);
    expect(simpleGlobMatch("foo.txt", "bar.txt")).toBe(false);
  });

  it("matches * wildcard (single segment)", () => {
    expect(simpleGlobMatch("*.ts", "foo.ts")).toBe(true);
    expect(simpleGlobMatch("*.ts", "foo.js")).toBe(false);
    expect(simpleGlobMatch("*.ts", "dir/foo.ts")).toBe(false);
  });

  it("matches ** wildcard (multiple segments)", () => {
    expect(simpleGlobMatch("**/*.ts", "foo.ts")).toBe(true);
    expect(simpleGlobMatch("**/*.ts", "src/foo.ts")).toBe(true);
    expect(simpleGlobMatch("**/*.ts", "src/deep/foo.ts")).toBe(true);
    expect(simpleGlobMatch("**/*.ts", "foo.js")).toBe(false);
  });

  it("matches directory prefix patterns", () => {
    expect(simpleGlobMatch(".git/**", ".git/config")).toBe(true);
    expect(simpleGlobMatch(".git/**", ".git/refs/heads")).toBe(true);
    expect(simpleGlobMatch(".git/**", "src/file.ts")).toBe(false);
  });

  it("matches node_modules pattern", () => {
    expect(simpleGlobMatch("node_modules/**", "node_modules/foo/bar.js")).toBe(true);
    expect(simpleGlobMatch("node_modules/**", "src/file.ts")).toBe(false);
  });

  it("matches .hench pattern", () => {
    expect(simpleGlobMatch(".hench/**", ".hench/config.json")).toBe(true);
    expect(simpleGlobMatch(".hench/**", ".hench/runs/abc.json")).toBe(true);
  });

  it("matches .rex pattern", () => {
    expect(simpleGlobMatch(".rex/**", ".rex/prd.json")).toBe(true);
    expect(simpleGlobMatch(".rex/**", ".rex/config.json")).toBe(true);
  });
});

describe("validatePath", () => {
  const projectDir = "/project";
  const blockedPaths = [".hench/**", ".rex/**", ".git/**", "node_modules/**"];

  it("allows valid relative paths", () => {
    const resolved = validatePath("src/file.ts", projectDir, blockedPaths);
    expect(resolved).toBe("/project/src/file.ts");
  });

  it("allows nested valid paths", () => {
    const resolved = validatePath("src/deep/file.ts", projectDir, blockedPaths);
    expect(resolved).toBe("/project/src/deep/file.ts");
  });

  it("rejects paths that escape project directory", () => {
    expect(() =>
      validatePath("../../etc/passwd", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects blocked .hench paths", () => {
    expect(() =>
      validatePath(".hench/config.json", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects blocked .rex paths", () => {
    expect(() =>
      validatePath(".rex/prd.json", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects blocked .git paths", () => {
    expect(() =>
      validatePath(".git/config", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects blocked node_modules paths", () => {
    expect(() =>
      validatePath("node_modules/foo/bar.js", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });
});
