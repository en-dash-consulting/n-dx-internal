/**
 * Unit tests for the plan-mode stall handler.
 *
 * Covers the decision tree the cliLoop relies on when the spawned Claude
 * session emits an `ExitPlanMode` tool_use:
 *   - TTY accept tokens → `{ action: "accept" }`
 *   - TTY reject tokens → `{ action: "reject" }`
 *   - any other reply → `{ action: "feedback", text }`
 *   - non-TTY → auto-accept (so unattended runs don't deadlock)
 *
 * Also pins the appendix shape so a brief re-spawned with `acceptEdits`
 * carries the captured plan plus the user's response.
 */

import { describe, it, expect } from "vitest";
import {
  handlePlanModeStall,
  formatPlanModeAppendix,
} from "../../../src/agent/lifecycle/plan-mode-prompt.js";
import type { PlanModeDecision } from "../../../src/agent/lifecycle/plan-mode-prompt.js";

function reader(answer: string) {
  return async () => answer;
}

describe("handlePlanModeStall: TTY", () => {
  it("treats empty input as accept", async () => {
    const decision = await handlePlanModeStall("Plan body", { isTty: true, readLine: reader("") });
    expect(decision).toEqual({ action: "accept" });
  });

  it("treats 'y' / 'yes' / 'accept' as accept (case-insensitive)", async () => {
    for (const reply of ["y", "Y", "yes", "YES", "accept", "Approve", "ok"]) {
      const decision = await handlePlanModeStall("Plan", { isTty: true, readLine: reader(reply) });
      expect(decision).toEqual({ action: "accept" });
    }
  });

  it("treats 'n' / 'no' / 'reject' / 'abort' / 'cancel' as reject", async () => {
    for (const reply of ["n", "no", "NO", "reject", "abort", "cancel", "Stop"]) {
      const decision = await handlePlanModeStall("Plan", { isTty: true, readLine: reader(reply) });
      expect(decision).toEqual({ action: "reject" });
    }
  });

  it("returns feedback for any other text", async () => {
    const decision = await handlePlanModeStall("Plan", {
      isTty: true,
      readLine: reader("please run the unit tests first"),
    });
    expect(decision).toEqual({ action: "feedback", text: "please run the unit tests first" });
  });

  it("trims whitespace before classification", async () => {
    const decision = await handlePlanModeStall("Plan", { isTty: true, readLine: reader("   y   ") });
    expect(decision).toEqual({ action: "accept" });
  });
});

describe("handlePlanModeStall: non-TTY", () => {
  it("auto-accepts without invoking the reader", async () => {
    let called = false;
    const decision = await handlePlanModeStall("Plan", {
      isTty: false,
      readLine: async () => {
        called = true;
        return "n";
      },
    });
    expect(decision).toEqual({ action: "accept" });
    expect(called).toBe(false);
  });

  it("does not throw when readLine is omitted", async () => {
    // No TTY → the default readLine is never reached.
    const decision = await handlePlanModeStall("Plan", { isTty: false });
    expect(decision).toEqual({ action: "accept" });
  });
});

describe("formatPlanModeAppendix", () => {
  it("includes the plan and an approval marker for accept decisions", () => {
    const decision: PlanModeDecision = { action: "accept" };
    const appendix = formatPlanModeAppendix("Step 1: do X\nStep 2: do Y", decision);

    expect(appendix).toContain("Prior plan (approved)");
    expect(appendix).toContain("Step 1: do X");
    expect(appendix).toContain("Step 2: do Y");
    expect(appendix).toContain("acceptEdits");
  });

  it("preserves user feedback verbatim and labels the section accordingly", () => {
    const decision: PlanModeDecision = { action: "feedback", text: "skip step 2" };
    const appendix = formatPlanModeAppendix("Plan content", decision);

    expect(appendix).toContain("Prior plan (approved with feedback)");
    expect(appendix).toContain("Plan content");
    expect(appendix).toContain("skip step 2");
    expect(appendix).toContain("acceptEdits");
  });

  it("handles empty plan text without crashing", () => {
    const appendix = formatPlanModeAppendix("", { action: "accept" });
    expect(appendix).toContain("Prior plan (approved)");
  });
});
