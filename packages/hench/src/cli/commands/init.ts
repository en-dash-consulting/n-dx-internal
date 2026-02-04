import { join } from "node:path";
import { ensureHenchDir, configExists, initConfig } from "../../store/index.js";
import { HENCH_DIR } from "./constants.js";

export async function cmdInit(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);

  if (await configExists(henchDir)) {
    console.log(".hench/ already initialized, skipping");
    return;
  }

  const config = await initConfig(henchDir);

  console.log("Created .hench/config.json");
  console.log("Created .hench/runs/");
  console.log(`\nInitialized .hench/ in ${dir}`);
  console.log(`Model: ${config.model}`);
  console.log(`Max turns: ${config.maxTurns}`);
  console.log(`Rex dir: ${config.rexDir}`);
  console.log("\nNext steps:");
  console.log("  hench run " + dir);
  console.log("  hench status " + dir);
}
