import { join, resolve } from "node:path";
import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createStore } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import {
  scanTests,
  scanDocs,
  scanSourceVision,
  reconcile,
  buildProposals,
  reasonFromFile,
  reasonFromScanResults,
} from "../../analyze/index.js";
import type { ScanResult, Proposal } from "../../analyze/index.js";
import type { PRDItem, PRDDocument } from "../../schema/index.js";

async function hasRexDir(dir: string): Promise<boolean> {
  try {
    await access(join(dir, REX_DIR));
    return true;
  } catch {
    return false;
  }
}

function formatProposals(proposals: Proposal[]): string {
  const lines: string[] = [];
  for (const p of proposals) {
    lines.push(`[epic] ${p.epic.title} (from: ${p.epic.source})`);
    for (const f of p.features) {
      lines.push(`  [feature] ${f.title} (from: ${f.source})`);
      for (const t of f.tasks) {
        const pri = t.priority ? ` [${t.priority}]` : "";
        lines.push(`    [task] ${t.title}${pri} (from: ${t.sourceFile})`);
      }
    }
  }
  return lines.join("\n");
}

export async function cmdAnalyze(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const lite = flags.lite === "true";
  const accept = flags.accept === "true";
  const noLlm = flags["no-llm"] === "true";
  const filePath = flags.file;

  // Load existing PRD items for deduplication
  let existing: PRDItem[] = [];
  if (await hasRexDir(dir)) {
    try {
      const rexDir = join(dir, REX_DIR);
      const store = createStore("file", rexDir);
      const doc = await store.loadDocument();
      existing = doc.items;
    } catch {
      // No valid PRD yet, treat as empty
    }
  }

  let proposals: Proposal[];

  if (filePath) {
    // --file mode: import from a document via LLM
    const resolved = resolve(dir, filePath);

    if (flags.format !== "json") {
      console.log(`Importing from file: ${resolved}`);
    }

    try {
      proposals = await reasonFromFile(resolved, existing);
    } catch (err) {
      console.error(`Failed to analyze file: ${(err as Error).message}`);
      process.exit(1);
    }

    if (flags.format === "json") {
      console.log(JSON.stringify({ proposals }, null, 2));
      return;
    }

    console.log(`LLM extracted ${proposals.length} epics from file.`);
  } else {
    // Scanner mode: run all three scanners
    const opts = { lite };
    const [testResults, docResults, svResults] = await Promise.all([
      scanTests(dir, opts),
      scanDocs(dir, opts),
      scanSourceVision(dir),
    ]);

    const allResults: ScanResult[] = [...testResults, ...docResults, ...svResults];

    const testFiles = new Set(testResults.map((r) => r.sourceFile)).size;
    const docFiles = new Set(docResults.map((r) => r.sourceFile)).size;
    const svZones = svResults.filter((r) => r.kind === "feature" && r.source === "sourcevision").length;

    const { results: newResults, stats } = reconcile(allResults, existing);

    if (!noLlm) {
      // Try LLM refinement
      try {
        proposals = await reasonFromScanResults(newResults, existing);
        if (flags.format !== "json") {
          console.log("Proposals refined by LLM.");
        }
      } catch {
        // Fall back to algorithmic
        proposals = buildProposals(newResults);
      }
    } else {
      proposals = buildProposals(newResults);
    }

    if (flags.format === "json") {
      console.log(
        JSON.stringify(
          { scanned: { testFiles, docFiles, svZones }, stats, proposals },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      `Scanned: ${testFiles} test files, ${docFiles} docs, ${svZones} sourcevision zones`,
    );
    console.log(
      `Found: ${stats.total} proposals (${stats.newCount} new, ${stats.alreadyTracked} already tracked)`,
    );
    console.log("");
  }

  if (proposals.length === 0) {
    console.log("No new proposals found.");
    return;
  }

  console.log(formatProposals(proposals));

  if (accept) {
    if (!(await hasRexDir(dir))) {
      console.error(
        `No .rex/ found in ${dir}. Run "rex init" first before using --accept.`,
      );
      process.exit(1);
    }

    const rexDir = join(dir, REX_DIR);
    const store = createStore("file", rexDir);

    console.log("");
    let addedCount = 0;

    for (const p of proposals) {
      // Create epic
      const epicId = randomUUID();
      const epicItem: PRDItem = {
        id: epicId,
        title: p.epic.title,
        level: "epic",
        status: "pending",
        source: p.epic.source,
      };
      await store.addItem(epicItem);
      addedCount++;

      for (const f of p.features) {
        // Create feature under epic
        const featureId = randomUUID();
        const featureItem: PRDItem = {
          id: featureId,
          title: f.title,
          level: "feature",
          status: "pending",
          source: f.source,
          description: f.description,
        };
        await store.addItem(featureItem, epicId);
        addedCount++;

        for (const t of f.tasks) {
          // Create task under feature
          const taskId = randomUUID();
          const taskItem: PRDItem = {
            id: taskId,
            title: t.title,
            level: "task",
            status: "pending",
            source: t.source,
            description: t.description,
            acceptanceCriteria: t.acceptanceCriteria,
            priority: t.priority as PRDItem["priority"],
            tags: t.tags,
          };
          await store.addItem(taskItem, featureId);
          addedCount++;
        }
      }
    }

    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "analyze_accept",
      detail: `Added ${addedCount} items from analysis`,
    });

    console.log(`Added ${addedCount} items to PRD.`);
  } else {
    console.log("");
    console.log("Run with --accept to add all proposals to the PRD.");
  }
}
