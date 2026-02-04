import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { PRDItem } from "../schema/index.js";
import type { ScanResult } from "./scanners.js";
import type { Proposal } from "./propose.js";
import { walkTree } from "../core/tree.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

// ── Zod schemas for LLM response validation ──

const ProposalTaskSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  tags: z.array(z.string()).optional(),
});

const ProposalFeatureSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  tasks: z.array(ProposalTaskSchema),
});

const ProposalSchema = z.object({
  epic: z.object({ title: z.string() }),
  features: z.array(ProposalFeatureSchema),
});

const ProposalArraySchema = z.array(ProposalSchema);

// ── Helpers ──

function summarizeExisting(items: PRDItem[]): string {
  const lines: string[] = [];
  for (const { item, parents } of walkTree(items)) {
    const indent = "  ".repeat(parents.length);
    lines.push(`${indent}- [${item.level}] ${item.title} (${item.status})`);
  }
  return lines.length > 0 ? lines.join("\n") : "(empty PRD)";
}

export function parseProposalResponse(raw: string): Proposal[] {
  // Strip markdown code fences if present
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(text);
  const validated = ProposalArraySchema.parse(parsed);

  // Normalize into full Proposal shape with source fields
  return validated.map((p) => ({
    epic: { title: p.epic.title, source: "llm" },
    features: p.features.map((f) => ({
      title: f.title,
      source: "llm",
      description: f.description,
      tasks: f.tasks.map((t) => ({
        title: t.title,
        source: "llm",
        sourceFile: "",
        description: t.description,
        acceptanceCriteria: t.acceptanceCriteria,
        priority: t.priority,
        tags: t.tags,
      })),
    })),
  }));
}

function spawnClaude(prompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--output-format", "json",
      "--model", model,
    ];

    const proc = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(
          "claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code",
        ));
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `claude exited with code ${code}`));
        return;
      }

      // --output-format json wraps result in { "result": "...", ... }
      try {
        const envelope = JSON.parse(stdout);
        resolve(typeof envelope.result === "string" ? envelope.result : stdout);
      } catch {
        resolve(stdout);
      }
    });
  });
}

// ── Public API ──

export async function reasonFromFile(
  filePath: string,
  existingItems: PRDItem[],
  model?: string,
): Promise<Proposal[]> {
  const content = await readFile(filePath, "utf-8");
  const existingSummary = summarizeExisting(existingItems);

  const prompt = `You are a product requirements analyst. Read the following document and extract a structured PRD (Product Requirements Document) as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

Group related items into epics and features logically. Derive tasks from actionable items in the document.

IMPORTANT: Do NOT include items that duplicate anything already in the existing PRD below.

Existing PRD:
${existingSummary}

Document to analyze:
${content}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;

  const raw = await spawnClaude(prompt, model ?? DEFAULT_MODEL);
  return parseProposalResponse(raw);
}

export async function reasonFromScanResults(
  results: ScanResult[],
  existingItems: PRDItem[],
  model?: string,
): Promise<Proposal[]> {
  const existingSummary = summarizeExisting(existingItems);

  // Summarize scan results for the LLM
  const scanSummary = results.map((r) => {
    const parts = [`[${r.kind}] ${r.name} (source: ${r.source}, file: ${r.sourceFile})`];
    if (r.description) parts.push(`  description: ${r.description}`);
    if (r.acceptanceCriteria?.length) parts.push(`  criteria: ${r.acceptanceCriteria.join("; ")}`);
    if (r.priority) parts.push(`  priority: ${r.priority}`);
    if (r.tags?.length) parts.push(`  tags: ${r.tags.join(", ")}`);
    return parts.join("\n");
  }).join("\n\n");

  const prompt = `You are a product requirements analyst. Given the following raw scan results from automated code analysis, organize them into a clean, well-structured PRD as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

Guidelines:
- Merge duplicate or near-duplicate items
- Create meaningful epic groupings (not just "Tests" or "Documentation")
- Rewrite vague titles to be clear and actionable
- Preserve priority levels from the scan results
- Do NOT include items that duplicate anything in the existing PRD

Existing PRD:
${existingSummary}

Scan results:
${scanSummary}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;

  const raw = await spawnClaude(prompt, model ?? DEFAULT_MODEL);
  return parseProposalResponse(raw);
}
