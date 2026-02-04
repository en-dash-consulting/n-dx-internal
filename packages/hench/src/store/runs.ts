import { join } from "node:path";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { validateRunRecord } from "../schema/index.js";
import { toCanonicalJSON } from "./json.js";
import type { RunRecord } from "../schema/index.js";

export async function saveRun(
  henchDir: string,
  run: RunRecord,
): Promise<void> {
  const runPath = join(henchDir, "runs", `${run.id}.json`);
  await writeFile(runPath, toCanonicalJSON(run), "utf-8");
}

export async function loadRun(
  henchDir: string,
  id: string,
): Promise<RunRecord> {
  const runPath = join(henchDir, "runs", `${id}.json`);
  const raw = await readFile(runPath, "utf-8");
  const data = JSON.parse(raw);
  const result = validateRunRecord(data);
  if (!result.ok) {
    throw new Error(`Invalid run record ${id}: ${result.errors.message}`);
  }
  return result.data as RunRecord;
}

export async function listRuns(
  henchDir: string,
  limit?: number,
): Promise<RunRecord[]> {
  const runsDir = join(henchDir, "runs");
  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return [];
  }

  const jsonFiles = files
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  const toLoad = limit ? jsonFiles.slice(0, limit) : jsonFiles;

  const runs: RunRecord[] = [];
  for (const file of toLoad) {
    const id = file.replace(/\.json$/, "");
    try {
      const run = await loadRun(henchDir, id);
      runs.push(run);
    } catch {
      // Skip invalid run files
    }
  }

  // Sort by startedAt descending
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return runs;
}
