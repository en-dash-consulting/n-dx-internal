/**
 * Plan-mode stall handler — prompts the user (or auto-accepts) when the
 * spawned Claude session emits an `ExitPlanMode` tool_use.
 *
 * Without this hook, an `ndx work` loop that lands in plan mode (either
 * because the user passed `--permission-mode plan` or the model called
 * `ExitPlanMode` on its own) would either silently exit with a plan-only
 * outcome or stall waiting for an approval that never arrives. This module
 * surfaces the plan to the operator inline — like a direct chat — so the
 * loop can keep moving.
 *
 * The handler is intentionally provider-agnostic: it accepts plan text and
 * returns a structured decision. Re-spawning with `permissionMode = "acceptEdits"`
 * and threading the plan back into the next brief is the caller's job.
 */

import { createInterface } from "node:readline";
import { info } from "../../types/output.js";

/**
 * Decision the caller should act on after surfacing a plan-mode stall.
 *
 * - `"accept"`: continue the run with `permissionMode = "acceptEdits"`.
 * - `"reject"`: abort the run with `status = "cancelled"`.
 * - `"feedback"`: continue with `acceptEdits`, but also append the user's
 *   reply to the brief so the next attempt incorporates the guidance.
 */
export type PlanModeDecision =
  | { action: "accept" }
  | { action: "reject" }
  | { action: "feedback"; text: string };

export interface PlanModeStallOptions {
  /**
   * Whether stdin is a TTY. When false, the handler skips the readline
   * prompt and returns `{ action: "accept" }` so non-interactive runs
   * (CI, `--background`, headless servers) don't deadlock.
   */
  isTty: boolean;
  /**
   * Optional injection point for tests — replaces `node:readline` with a
   * caller-provided async reader so unit tests don't need a real TTY.
   */
  readLine?: (prompt: string) => Promise<string>;
}

const ACCEPT_TOKENS = new Set(["", "y", "yes", "accept", "approve", "ok"]);
const REJECT_TOKENS = new Set(["n", "no", "reject", "abort", "cancel", "stop"]);

/**
 * Display the captured plan text to the user, then read a single line from
 * stdin (when interactive) and translate it into a {@link PlanModeDecision}.
 *
 * Without a TTY this is a no-op: the function logs a structured message
 * explaining that plan mode was reached and returns `{ action: "accept" }`.
 * That keeps unattended pipelines moving while leaving a paper trail.
 */
export async function handlePlanModeStall(
  planText: string,
  opts: PlanModeStallOptions,
): Promise<PlanModeDecision> {
  if (!opts.isTty) {
    info(
      "⚠ Plan mode reached without an attached TTY — auto-accepting and " +
      "continuing with permission mode 'acceptEdits'. Pass " +
      "--permission-mode acceptEdits up front to skip this prompt.",
    );
    return { action: "accept" };
  }

  info("\n══════════════════════════════════════════════════════════════");
  info("Plan mode reached. The agent has produced this plan:");
  info("──────────────────────────────────────────────────────────────");
  info(planText.trim().length > 0 ? planText.trim() : "(no plan content captured)");
  info("──────────────────────────────────────────────────────────────");
  info("Reply [Enter/y]=accept  [n]=reject  or type guidance to send back as feedback.");

  const reader = opts.readLine ?? defaultReadLine;
  const reply = (await reader("> ")).trim();
  const lower = reply.toLowerCase();

  if (ACCEPT_TOKENS.has(lower)) return { action: "accept" };
  if (REJECT_TOKENS.has(lower)) return { action: "reject" };
  return { action: "feedback", text: reply };
}

async function defaultReadLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(prompt, (answer) => resolve(answer));
    });
  } finally {
    rl.close();
  }
}

/**
 * Build the brief appendix that's threaded back into the next spawn after
 * an `accept` or `feedback` decision. Captures both the plan and the user's
 * response so the agent picks up where the planner left off.
 */
export function formatPlanModeAppendix(
  planText: string,
  decision: PlanModeDecision,
): string {
  const trimmed = planText.trim();
  const planBlock = trimmed ? `\n\n${trimmed}` : "";

  if (decision.action === "feedback") {
    return (
      "## Prior plan (approved with feedback)\n" +
      "The previous attempt entered plan mode and produced this plan:" +
      planBlock +
      "\n\nUser feedback before continuing:\n" +
      decision.text.trim() +
      "\n\nProceed with the plan, incorporating the feedback above. " +
      "Permission mode has been switched to acceptEdits — execute directly."
    );
  }

  // accept (the only other action that produces an appendix; reject aborts)
  return (
    "## Prior plan (approved)\n" +
    "The previous attempt entered plan mode and produced this plan:" +
    planBlock +
    "\n\nThe user has approved the plan. Proceed with execution. " +
    "Permission mode has been switched to acceptEdits."
  );
}
