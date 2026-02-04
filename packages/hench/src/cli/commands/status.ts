import { join } from "node:path";
import { listRuns } from "../../store/index.js";
import { HENCH_DIR, safeParseInt } from "./constants.js";

export async function cmdStatus(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);
  const limit = flags.last ? safeParseInt(flags.last, "last") : 10;
  const runs = await listRuns(henchDir, limit);

  if (runs.length === 0) {
    console.log("No runs found. Use 'hench run' to execute a task.");
    return;
  }

  if (flags.format === "json") {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }

  console.log(`Recent runs (${runs.length}):\n`);

  for (const run of runs) {
    const status = statusIcon(run.status);
    const duration = run.finishedAt
      ? formatDuration(
          new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime(),
        )
      : "running";

    console.log(`${status} ${run.id.slice(0, 8)}  ${run.taskTitle}`);
    console.log(`  ${run.status} | ${run.turns} turns | ${duration} | ${run.model}`);
    console.log(`  tokens: ${run.tokenUsage.input} in / ${run.tokenUsage.output} out`);
    if (run.error) {
      console.log(`  error: ${run.error}`);
    }
    console.log();
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "completed":
      return "[ok]";
    case "failed":
      return "[!!]";
    case "timeout":
      return "[to]";
    case "running":
      return "[..]";
    default:
      return "[??]";
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}
