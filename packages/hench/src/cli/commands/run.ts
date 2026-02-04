import { join } from "node:path";
import { createStore } from "rex/dist/store/index.js";
import { loadConfig } from "../../store/index.js";
import { agentLoop } from "../../agent/loop.js";
import { cliLoop } from "../../agent/cli-loop.js";
import { HENCH_DIR, safeParseInt } from "./constants.js";

export async function cmdRun(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);
  const config = await loadConfig(henchDir);
  const rexDir = join(dir, config.rexDir);
  const store = createStore("file", rexDir);

  const provider = (flags.provider as "cli" | "api") ?? config.provider;
  const taskId = flags.task;
  const dryRun = flags["dry-run"] === "true";
  const model = flags.model;

  const result = provider === "cli"
    ? await cliLoop({
        config: { ...config, provider },
        store,
        projectDir: dir,
        henchDir,
        taskId,
        dryRun,
        model,
      })
    : await agentLoop({
        config: { ...config, provider },
        store,
        projectDir: dir,
        henchDir,
        taskId,
        dryRun,
        maxTurns: flags["max-turns"] ? safeParseInt(flags["max-turns"], "max-turns") : undefined,
        model,
      });

  const { run } = result;

  console.log("\n=== Run Complete ===");
  console.log(`Run ID: ${run.id}`);
  console.log(`Task: ${run.taskTitle}`);
  console.log(`Status: ${run.status}`);
  console.log(`Turns: ${run.turns}`);
  console.log(`Tokens: ${run.tokenUsage.input} in / ${run.tokenUsage.output} out`);
  console.log(`Tool calls: ${run.toolCalls.length}`);

  if (run.summary) {
    console.log(`\nSummary: ${run.summary}`);
  }
  if (run.error) {
    console.log(`\nError: ${run.error}`);
  }
}
