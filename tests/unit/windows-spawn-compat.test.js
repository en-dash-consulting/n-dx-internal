/**
 * Windows spawn compatibility tests.
 *
 * Verifies that orchestration-layer scripts use platform-compatible spawn
 * patterns. On Windows, Node.js CLIs installed via npm are registered as
 * .cmd shims — bare execFileSync("cli-name") without shell:true fails with
 * ENOENT. Similarly, spawning "node" by name is less reliable than using
 * process.execPath.
 *
 * These are source-code assertion tests that prevent regressions without
 * requiring a real Windows environment.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = join(import.meta.dirname, "../..");

function readSource(relPath) {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// cli.js spawn patterns
// ---------------------------------------------------------------------------

describe("cli.js — Windows-compatible spawn patterns", () => {
  const source = readSource("packages/core/cli.js");

  it("runInitCapture uses process.execPath, not bare 'node'", () => {
    // Extract just the runInitCapture function body
    const fnStart = source.indexOf("function runInitCapture(");
    const fnEnd = source.indexOf("\nfunction ", fnStart + 1);
    const fnBody = source.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

    expect(fnBody).toContain("process.execPath");
    expect(fnBody).not.toMatch(/spawnTracked\(["']node["']/);
  });

  it("handlePairProgramming uses process.execPath for rex CLI invocations", () => {
    // Both execFileSync("node", [...]) calls inside handlePairProgramming
    // must be replaced with execFileSync(process.execPath, [...]).
    const fnStart = source.indexOf("async function handlePairProgramming(");
    const fnEnd = source.indexOf("\nasync function handle", fnStart + 1);
    const fnBody = source.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

    const bareNodeMatches = (fnBody.match(/execFileSync\(["']node["']/g) || []).length;
    expect(
      bareNodeMatches,
      "handlePairProgramming should not call execFileSync with a bare 'node' string — use process.execPath",
    ).toBe(0);
  });

  it("handlePairProgramming contains process.execPath for synchronous rex calls", () => {
    const fnStart = source.indexOf("async function handlePairProgramming(");
    const fnEnd = source.indexOf("\nasync function handle", fnStart + 1);
    const fnBody = source.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

    expect(fnBody).toContain("process.execPath");
  });
});

// ---------------------------------------------------------------------------
// pair-programming.js — shell flag for Windows .cmd shims
// ---------------------------------------------------------------------------

describe("pair-programming.js — Windows-compatible execFileSync calls", () => {
  const source = readSource("packages/core/pair-programming.js");

  it("execFileSync('rex', ...) includes shell: process.platform === \"win32\" for Windows .cmd shim support", () => {
    // Find the execFileSync("rex", ...) call in buildPrdStatusExcerpt
    const callIndex = source.indexOf('execFileSync("rex"');
    expect(callIndex).toBeGreaterThan(-1);

    // The next ~200 chars after the call should contain the shell option
    const callContext = source.slice(callIndex, callIndex + 300);
    expect(callContext).toContain('shell: process.platform === "win32"');
  });
});
