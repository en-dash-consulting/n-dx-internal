import { join } from "node:path";
import { loadRun } from "../../store/index.js";
import { HENCH_DIR } from "./constants.js";
import { info, result } from "../output.js";

export async function cmdShow(
  dir: string,
  runId: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);
  const run = await loadRun(henchDir, runId);

  if (flags.format === "json") {
    result(JSON.stringify(run, null, 2));
    return;
  }

  result(`Run: ${run.id}`);
  result(`Task: ${run.taskTitle} (${run.taskId})`);
  info(`Model: ${run.model}`);
  result(`Status: ${run.status}`);
  info(`Started: ${run.startedAt}`);
  if (run.finishedAt) info(`Finished: ${run.finishedAt}`);
  info(`Turns: ${run.turns}`);
  info(`Tokens: ${run.tokenUsage.input} in / ${run.tokenUsage.output} out`);

  if (run.summary) {
    info(`\nSummary:\n${run.summary}`);
  }

  if (run.error) {
    result(`\nError:\n${run.error}`);
  }

  if (run.toolCalls.length > 0) {
    info(`\nTool Calls (${run.toolCalls.length}):`);
    for (const call of run.toolCalls) {
      const inputStr = JSON.stringify(call.input).slice(0, 80);
      info(`  [${call.turn}] ${call.tool}(${inputStr}) — ${call.durationMs}ms`);
      if (call.output.startsWith("[GUARD]") || call.output.startsWith("[ERROR]")) {
        info(`       ${call.output.slice(0, 120)}`);
      }
    }
  }
}
