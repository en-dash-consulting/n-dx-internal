import { join } from "node:path";
import { ensureHenchDir, configExists, initConfig } from "../../store/index.js";
import { HENCH_DIR } from "./constants.js";
import { info } from "../output.js";

export async function cmdInit(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);

  if (await configExists(henchDir)) {
    info(".hench/ already initialized, skipping");
    return;
  }

  const config = await initConfig(henchDir);

  info("Created .hench/config.json");
  info("Created .hench/runs/");
  info(`\nInitialized .hench/ in ${dir}`);
  info(`Model: ${config.model}`);
  info(`Max turns: ${config.maxTurns}`);
  info(`Rex dir: ${config.rexDir}`);
  info("\nNext steps:");
  info("  hench run " + dir);
  info("  hench status " + dir);
}
