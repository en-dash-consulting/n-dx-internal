import { existsSync, mkdirSync, rmSync, readdirSync, copyFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { SV_DIR } from "./constants.js";
import { info } from "../output.js";

export function cmdReset(dir: string): void {
  const absDir = resolve(dir);
  const svDir = join(absDir, SV_DIR);

  if (!existsSync(svDir)) {
    info(`No .sourcevision/ directory found in ${absDir} — nothing to reset.`);
    return;
  }

  // Backup current analysis files before clearing
  const backupDir = join(svDir, ".backup");
  if (existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true, force: true });
  }
  mkdirSync(backupDir, { recursive: true });

  const entries = readdirSync(svDir);
  for (const entry of entries) {
    if (entry === ".backup" || entry === ".gitignore") continue;
    const src = join(svDir, entry);
    if (statSync(src).isFile()) {
      copyFileSync(src, join(backupDir, entry));
    }
  }

  // Ensure .backup is gitignored
  writeFileSync(join(svDir, ".gitignore"), ".backup/\n");

  // Remove all analysis files (keep .backup and .gitignore)
  for (const entry of entries) {
    if (entry === ".backup" || entry === ".gitignore") continue;
    rmSync(join(svDir, entry), { recursive: true, force: true });
  }

  info(`Backed up analysis to ${backupDir}`);
  info(`Cleared ${svDir}`);
  info("Run 'sourcevision analyze' to start fresh.");
}
