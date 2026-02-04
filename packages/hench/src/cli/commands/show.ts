import { join } from "node:path";
import { loadRun } from "../../store/index.js";
import { HENCH_DIR } from "./constants.js";

export async function cmdShow(
  dir: string,
  runId: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);
  const run = await loadRun(henchDir, runId);

  if (flags.format === "json") {
    console.log(JSON.stringify(run, null, 2));
    return;
  }

  console.log(`Run: ${run.id}`);
  console.log(`Task: ${run.taskTitle} (${run.taskId})`);
  console.log(`Model: ${run.model}`);
  console.log(`Status: ${run.status}`);
  console.log(`Started: ${run.startedAt}`);
  if (run.finishedAt) console.log(`Finished: ${run.finishedAt}`);
  console.log(`Turns: ${run.turns}`);
  console.log(`Tokens: ${run.tokenUsage.input} in / ${run.tokenUsage.output} out`);

  if (run.summary) {
    console.log(`\nSummary:\n${run.summary}`);
  }

  if (run.error) {
    console.log(`\nError:\n${run.error}`);
  }

  if (run.toolCalls.length > 0) {
    console.log(`\nTool Calls (${run.toolCalls.length}):`);
    for (const call of run.toolCalls) {
      const inputStr = JSON.stringify(call.input).slice(0, 80);
      console.log(`  [${call.turn}] ${call.tool}(${inputStr}) — ${call.durationMs}ms`);
      if (call.output.startsWith("[GUARD]") || call.output.startsWith("[ERROR]")) {
        console.log(`       ${call.output.slice(0, 120)}`);
      }
    }
  }
}
