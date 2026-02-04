import { join } from "node:path";
import { access, readFile } from "node:fs/promises";
import { createStore } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import type { PRDItem, ItemLevel } from "../../schema/index.js";
import { randomUUID } from "node:crypto";

interface Finding {
  severity: string;
  category: string;
  message: string;
  file?: string;
}

interface Recommendation {
  title: string;
  level: ItemLevel;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  source: string;
}

async function detectSourceVision(dir: string): Promise<boolean> {
  try {
    await access(join(dir, ".sourcevision"));
    return true;
  } catch {
    return false;
  }
}

interface RawFinding {
  type?: string;
  severity?: string;
  text?: string;
  message?: string;
  scope?: string;
  category?: string;
  file?: string;
}

async function readFindings(
  dir: string,
  severities: string[],
): Promise<Finding[]> {
  const zonesPath = join(dir, ".sourcevision", "zones.json");
  const raw = await readFile(zonesPath, "utf-8");
  const data = JSON.parse(raw);

  const rawFindings: RawFinding[] = data.findings ?? [];
  const sevSet = new Set(severities);

  return rawFindings
    .filter((f) => f.severity && sevSet.has(f.severity))
    .map((f) => ({
      severity: f.severity!,
      category: f.category ?? f.type ?? "general",
      message: f.message ?? f.text ?? "",
      file: f.file,
    }));
}

function mapFindingsToRecommendations(findings: Finding[]): Recommendation[] {
  const grouped = new Map<string, Finding[]>();
  for (const f of findings) {
    const group = grouped.get(f.category) ?? [];
    group.push(f);
    grouped.set(f.category, group);
  }

  const recommendations: Recommendation[] = [];
  for (const [category, items] of grouped) {
    const hasCritical = items.some((f) => f.severity === "critical");
    recommendations.push({
      title: `Address ${category} issues (${items.length} findings)`,
      level: "feature",
      description: items.map((f) => `- ${f.message}`).join("\n"),
      priority: hasCritical ? "critical" : "high",
      source: "sourcevision",
    });
  }

  return recommendations;
}

export async function cmdRecommend(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const hasSourceVision = await detectSourceVision(dir);
  if (!hasSourceVision) {
    console.log("SourceVision not detected.");
    console.log("Run 'sourcevision analyze' first, or pass a project with .sourcevision/");
    return;
  }

  let findings: Finding[];
  try {
    findings = await readFindings(dir, ["warning", "critical"]);
  } catch (err) {
    console.error("Failed to read SourceVision findings:", (err as Error).message);
    return;
  }

  if (findings.length === 0) {
    console.log("No findings to recommend.");
    return;
  }

  const recommendations = mapFindingsToRecommendations(findings);

  if (flags.format === "json") {
    console.log(JSON.stringify(recommendations, null, 2));
    return;
  }

  console.log(`\n${recommendations.length} recommended items:\n`);
  for (const rec of recommendations) {
    console.log(`  [${rec.priority}] ${rec.title}`);
    console.log(`    ${rec.description.split("\n")[0]}`);
    console.log("");
  }

  if (flags.accept) {
    const rexDir = join(dir, REX_DIR);
    const store = createStore("file", rexDir);

    for (const rec of recommendations) {
      const item: PRDItem = {
        id: randomUUID(),
        title: rec.title,
        level: rec.level,
        status: "pending",
        description: rec.description,
        priority: rec.priority,
        source: rec.source,
      };
      await store.addItem(item);
      console.log(`Added: ${rec.title} (${item.id})`);
    }
  } else {
    console.log("Run with --accept to add all recommendations to the PRD.");
  }
}
