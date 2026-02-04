import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { SCHEMA_VERSION } from "../../schema/v1.js";
import { TOOL_VERSION, SV_DIR } from "./constants.js";
import { info } from "../output.js";

export function cmdInit(dir: string): void {
  const absDir = resolve(dir);
  const svDir = join(absDir, SV_DIR);

  if (existsSync(join(svDir, "manifest.json"))) {
    info(`.sourcevision/ already initialized in ${absDir}`);
    info("Run 'sourcevision analyze' to update.");
    return;
  }

  mkdirSync(svDir, { recursive: true });

  // Git info
  let gitSha: string | undefined;
  let gitBranch: string | undefined;
  try {
    gitSha = execSync("git rev-parse HEAD", { cwd: absDir, encoding: "utf-8" }).trim();
    gitBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: absDir, encoding: "utf-8" }).trim();
  } catch {
    // not a git repo, that's fine
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    toolVersion: TOOL_VERSION,
    analyzedAt: new Date().toISOString(),
    ...(gitSha ? { gitSha } : {}),
    ...(gitBranch ? { gitBranch } : {}),
    targetPath: absDir,
    modules: {},
  };

  writeFileSync(join(svDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  info(`Initialized .sourcevision/ in ${absDir}`);
  info(`  ${join(svDir, "manifest.json")} created`);
  info("");
  info("Analysis output saved to .sourcevision/ — this is designed to be committed to your repo.");
  info("The viewer UI is served from the sourcevision package and is not stored in your project.");
  info("");

  info("Next steps:");
  info("  sourcevision analyze    Run the analysis pipeline");
  info("  sourcevision serve      View results in the browser");
}
