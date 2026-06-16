/**
 * Tests for --verbose stderr capture behavior.
 *
 * When --verbose is active and a spawned child exits non-zero, its stderr
 * is captured and printed inline after a [verbose] label.  In non-verbose
 * mode the child's stderr passes through unchanged (stdio inherit).
 */

import { describe, it, expect } from "vitest";
import { runFail, runResult } from "./e2e-helpers.js";

describe("--verbose child stderr capture", () => {
  describe("verbose mode: sub-command stderr surfaced on non-zero exit", () => {
    it("prints captured child stderr when child exits non-zero", () => {
      // sourcevision --unknown writes an error to stderr and exits non-zero.
      // In verbose mode the orchestrator captures and prints that stderr.
      const { stderr } = runFail(["sourcevision", "--verbose", "--unknown"]);
      expect(stderr).toContain("Unknown");
    });

    it("includes [verbose] label in stderr output", () => {
      const { stderr } = runFail(["sourcevision", "--verbose", "--unknown"]);
      expect(stderr).toContain("[verbose]");
    });
  });

  describe("non-verbose mode: sub-command stderr passes through unchanged", () => {
    it("does not add [verbose] label without --verbose flag", () => {
      // Without --verbose the orchestrator does not add a [verbose] label;
      // sub-command stderr flows via stdio inherit (no label wrapper).
      const { stderr } = runFail(["sourcevision", "--unknown"]);
      expect(stderr).not.toContain("[verbose]");
    });
  });
});
