import { join, basename } from "node:path";
import { writeFile, access } from "node:fs/promises";
import { SCHEMA_VERSION, DEFAULT_CONFIG } from "../../schema/index.js";
import { toCanonicalJSON } from "../../core/canonical.js";
import { ensureRexDir } from "../../store/index.js";
import { DEFAULT_WORKFLOW } from "../../workflow/default.js";
import { REX_DIR } from "./constants.js";
import type { PRDDocument } from "../../schema/index.js";

export async function cmdInit(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);

  await ensureRexDir(rexDir);

  const project = flags.project ?? basename(dir);

  // config.json
  const configPath = join(rexDir, "config.json");
  try {
    await access(configPath);
    console.log("config.json already exists, skipping");
  } catch {
    const config = DEFAULT_CONFIG(project);
    await writeFile(configPath, toCanonicalJSON(config), "utf-8");
    console.log("Created config.json");
  }

  // prd.json
  const prdPath = join(rexDir, "prd.json");
  try {
    await access(prdPath);
    console.log("prd.json already exists, skipping");
  } catch {
    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: project,
      items: [],
    };
    await writeFile(prdPath, toCanonicalJSON(doc), "utf-8");
    console.log("Created prd.json");
  }

  // execution-log.jsonl
  const logPath = join(rexDir, "execution-log.jsonl");
  try {
    await access(logPath);
    console.log("execution-log.jsonl already exists, skipping");
  } catch {
    await writeFile(logPath, "", "utf-8");
    console.log("Created execution-log.jsonl");
  }

  // workflow.md
  const workflowPath = join(rexDir, "workflow.md");
  try {
    await access(workflowPath);
    console.log("workflow.md already exists, skipping");
  } catch {
    await writeFile(workflowPath, DEFAULT_WORKFLOW, "utf-8");
    console.log("Created workflow.md");
  }

  console.log(`\nInitialized .rex/ in ${dir}`);
  console.log("Next steps:");
  console.log("  rex add epic --title=\"Your first epic\" " + dir);
  console.log("  rex status " + dir);
}
