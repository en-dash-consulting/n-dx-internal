import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import type { PRDItem } from "../schema/index.js";
import type { ScanResult } from "./scanners.js";
import type { Proposal, ProposalTask } from "./propose.js";
import { walkTree } from "../core/tree.js";

export const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/** Maximum number of LLM retry attempts for transient/parse failures. */
export const MAX_RETRIES = 2;

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

// ── Project context loading ──

/** Doc files to search for, in priority order. First found wins per slot. */
const PROJECT_DOC_FILES = [
  "CLAUDE.md",
  "README.md",
  "README",
  "README.txt",
];

/** Max characters of project context to include in the LLM prompt. */
const MAX_CONTEXT_LENGTH = 4000;

/**
 * Read project documentation files from `dir`. Returns a trimmed string
 * suitable for inclusion in an LLM prompt, or an empty string if nothing
 * useful is found.
 */
export async function readProjectContext(dir: string): Promise<string> {
  const sections: string[] = [];
  let totalLength = 0;

  for (const name of PROJECT_DOC_FILES) {
    if (totalLength >= MAX_CONTEXT_LENGTH) break;
    try {
      const content = await readFile(join(dir, name), "utf-8");
      const trimmed = content.trim();
      if (trimmed.length === 0) continue;

      const remaining = MAX_CONTEXT_LENGTH - totalLength;
      const snippet =
        trimmed.length > remaining
          ? trimmed.slice(0, remaining) + "\n...(truncated)"
          : trimmed;

      sections.push(`--- ${name} ---\n${snippet}`);
      totalLength += snippet.length;
    } catch {
      // File not found — skip
    }
  }

  return sections.join("\n\n");
}

/**
 * Extract JSON text from an LLM response, handling markdown fences,
 * leading prose, and trailing text after the JSON array.
 */
export function extractJson(raw: string): string {
  let text = raw.trim();

  // Try markdown code fences first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // If it already looks like a JSON object (not an array), return as-is —
  // the caller (parseProposalResponse) will handle schema validation.
  if (text.startsWith("{")) {
    return text;
  }

  // Find the start of a top-level JSON array. When text already starts with
  // `[`, the search begins at index 0. Otherwise, look for `[` at the
  // beginning of a line (to avoid matching arrays embedded in object values).
  let arrayStart = -1;
  if (text.startsWith("[")) {
    arrayStart = 0;
  } else {
    const match = text.match(/(?:^|\n)\s*(\[)/);
    if (match) {
      arrayStart = text.indexOf(match[1], match.index!);
    }
  }

  if (arrayStart >= 0) {
    text = text.slice(arrayStart);

    // Find the matching closing bracket, accounting for nesting and strings
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          return text.slice(0, i + 1);
        }
      }
    }
  }

  return text;
}

/**
 * Attempt to repair truncated JSON by closing any open structures.
 * Returns repaired JSON string or null if not repairable.
 */
export function repairTruncatedJson(text: string): string | null {
  // Only attempt repair on text that starts as a JSON array
  const trimmed = text.trim();
  if (!trimmed.startsWith("[")) return null;

  // Try parsing as-is first
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue with repair
  }

  // Track open brackets, braces, and string state
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (const ch of trimmed) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "[" || ch === "{") {
      stack.push(ch);
    } else if (ch === "]" || ch === "}") {
      stack.pop();
    }
  }

  if (stack.length === 0) return null;

  // Close any unclosed string
  let repaired = trimmed;
  if (inString) repaired += '"';

  // Close structures in reverse order
  while (stack.length > 0) {
    const open = stack.pop()!;
    repaired += open === "[" ? "]" : "}";
  }

  // Validate the repaired JSON actually parses
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

export function parseProposalResponse(raw: string): Proposal[] {
  const text = extractJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Attempt to repair truncated JSON from cut-off responses
    const repaired = repairTruncatedJson(text);
    if (repaired) {
      parsed = JSON.parse(repaired);
    } else {
      throw new Error(`Invalid JSON in LLM response: ${text.slice(0, 200)}`);
    }
  }

  // Try strict validation first
  const strict = ProposalArraySchema.safeParse(parsed);
  if (strict.success) {
    return normalizeProposals(strict.data);
  }

  // Lenient fallback: parse valid items individually, skip broken ones
  if (Array.isArray(parsed) && parsed.length > 0) {
    const valid: z.infer<typeof ProposalSchema>[] = [];
    for (const item of parsed) {
      const result = ProposalSchema.safeParse(item);
      if (result.success) {
        valid.push(result.data);
      }
    }
    if (valid.length > 0) {
      return normalizeProposals(valid);
    }
  }

  // Nothing salvageable — throw with original error detail
  throw new Error(
    `LLM response failed schema validation: ${strict.error.issues.map((i) => i.message).join("; ")}`,
  );
}

/**
 * Convert Zod-validated proposals into the full Proposal shape with source fields.
 */
function normalizeProposals(
  validated: z.infer<typeof ProposalArraySchema>,
): Proposal[] {
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

// ── Quality validation ──

export interface QualityIssue {
  level: "warning" | "error";
  path: string;
  message: string;
}

/**
 * Validate semantic quality of LLM-generated proposals.
 * Returns issues found. Empty array means all quality checks passed.
 */
export function validateProposalQuality(proposals: Proposal[]): QualityIssue[] {
  const issues: QualityIssue[] = [];

  for (const p of proposals) {
    const epicPath = `epic:"${p.epic.title}"`;

    // Epic title quality
    if (p.epic.title.length < 3) {
      issues.push({
        level: "warning",
        path: epicPath,
        message: "Epic title is too short to be descriptive",
      });
    }
    if (p.features.length === 0) {
      issues.push({
        level: "warning",
        path: epicPath,
        message: "Epic has no features",
      });
    }

    for (const f of p.features) {
      const featurePath = `${epicPath} > feature:"${f.title}"`;

      if (f.tasks.length === 0) {
        issues.push({
          level: "warning",
          path: featurePath,
          message: "Feature has no tasks",
        });
      }

      for (const t of f.tasks) {
        const taskPath = `${featurePath} > task:"${t.title}"`;

        // Tasks should have descriptions or acceptance criteria
        if (!t.description && (!t.acceptanceCriteria || t.acceptanceCriteria.length === 0)) {
          issues.push({
            level: "warning",
            path: taskPath,
            message: "Task lacks both description and acceptance criteria",
          });
        }

        // Very short task titles suggest vague output
        if (t.title.length < 5) {
          issues.push({
            level: "warning",
            path: taskPath,
            message: "Task title is too short to be actionable",
          });
        }
      }
    }
  }

  return issues;
}

// ── LLM interaction ──

function spawnClaudeOnce(prompt: string, model: string): Promise<string> {
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

/**
 * Spawn claude CLI with automatic retry on transient failures.
 * Retries up to MAX_RETRIES times with exponential backoff.
 * Non-retryable errors (ENOENT for missing CLI) are thrown immediately.
 */
async function spawnClaude(prompt: string, model: string): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await spawnClaudeOnce(prompt, model);
    } catch (err) {
      lastError = err as Error;

      // Don't retry if the CLI itself is missing
      if (lastError.message.includes("claude CLI not found")) {
        throw lastError;
      }

      // Don't retry on the last attempt
      if (attempt < MAX_RETRIES) {
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError!;
}

// ── Format detection ──

export type FileFormat = "markdown" | "json" | "yaml";

const FORMAT_MAP: Record<string, FileFormat> = {
  ".md": "markdown",
  ".txt": "markdown",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export function detectFileFormat(filePath: string): FileFormat {
  const ext = extname(filePath).toLowerCase();
  return FORMAT_MAP[ext] ?? "markdown";
}

// ── Structured file parsing (JSON/YAML without LLM) ──

function extractJsonItems(
  content: string,
): { name: string; description?: string }[] {
  try {
    const data = JSON.parse(content);
    const items: { name: string; description?: string }[] = [];

    function scan(obj: unknown): void {
      if (Array.isArray(obj)) {
        for (const el of obj) scan(el);
      } else if (obj && typeof obj === "object") {
        const o = obj as Record<string, unknown>;
        const name = (o.title ?? o.name) as string | undefined;
        if (typeof name === "string") {
          items.push({
            name,
            description: typeof o.description === "string" ? o.description : undefined,
          });
        }
        for (const val of Object.values(o)) {
          if (typeof val === "object" && val !== null) scan(val);
        }
      }
    }

    scan(data);
    return items;
  } catch {
    return [];
  }
}

function extractYamlItems(
  content: string,
): { name: string; description?: string }[] {
  const items: { name: string; description?: string }[] = [];
  const lines = content.split("\n");
  let currentName: string | null = null;
  let currentDesc: string | null = null;

  for (const line of lines) {
    const nameMatch = line.match(/^\s*(?:title|name)\s*:\s*["']?(.+?)["']?\s*$/);
    if (nameMatch) {
      if (currentName) {
        items.push({
          name: currentName,
          description: currentDesc ?? undefined,
        });
      }
      currentName = nameMatch[1];
      currentDesc = null;
      continue;
    }
    const descMatch = line.match(/^\s*description\s*:\s*["']?(.+?)["']?\s*$/);
    if (descMatch && currentName) {
      currentDesc = descMatch[1];
    }
  }
  if (currentName) {
    items.push({
      name: currentName,
      description: currentDesc ?? undefined,
    });
  }
  return items;
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * Attempt to parse structured file content (JSON/YAML) directly into proposals
 * without an LLM call. Returns null if the format is markdown or if the content
 * cannot be meaningfully extracted.
 */
export function parseStructuredFile(
  content: string,
  format: FileFormat,
  existingItems: PRDItem[],
): Proposal[] | null {
  if (format === "markdown") return null;

  // For JSON, first try to parse as the full Proposal schema
  if (format === "json") {
    try {
      let text = content.trim();
      const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (fenceMatch) text = fenceMatch[1].trim();

      const parsed = JSON.parse(text);
      const validated = ProposalArraySchema.parse(parsed);

      if (validated.length === 0) return null;

      // Existing title set for dedup
      const existingTitles = new Set(
        existingItems.map((item) => normalize(item.title)),
      );

      return validated
        .map((p) => ({
          epic: { title: p.epic.title, source: "file-import" },
          features: p.features
            .filter((f) => !existingTitles.has(normalize(f.title)))
            .map((f) => ({
              title: f.title,
              source: "file-import",
              description: f.description,
              tasks: f.tasks
                .filter((t) => !existingTitles.has(normalize(t.title)))
                .map((t) => ({
                  title: t.title,
                  source: "file-import",
                  sourceFile: "",
                  description: t.description,
                  acceptanceCriteria: t.acceptanceCriteria,
                  priority: t.priority,
                  tags: t.tags,
                })),
            })),
        }))
        .filter((p) => p.features.length > 0 || !existingTitles.has(normalize(p.epic.title)));
    } catch {
      // Not in Proposal schema — fall through to generic extraction
    }
  }

  // Generic extraction: pull title/name items from JSON or YAML
  const items =
    format === "json" ? extractJsonItems(content) : extractYamlItems(content);

  if (items.length === 0) return null;

  // Dedup against existing PRD
  const existingTitles = new Set(
    existingItems.map((item) => normalize(item.title)),
  );
  const newItems = items.filter((i) => !existingTitles.has(normalize(i.name)));

  if (newItems.length === 0) return null;

  // Group into a single "Imported Items" epic with each item as a feature
  return [
    {
      epic: { title: "Imported Items", source: "file-import" },
      features: newItems.map((item) => ({
        title: item.name,
        source: "file-import",
        description: item.description,
        tasks: [],
      })),
    },
  ];
}

// ── Format-specific LLM prompt hints ──

const FORMAT_HINTS: Record<FileFormat, string> = {
  markdown:
    "The document is in Markdown format. Pay attention to headings, bullet points, and structured sections.",
  json:
    "The document is in JSON format. Extract meaningful requirements from the structured data, including nested objects and arrays.",
  yaml:
    "The document is in YAML format. Extract meaningful requirements from the structured data fields.",
};

// ── Few-shot example for LLM prompts ──

/**
 * A compact example included in prompts to show the LLM the expected output
 * shape, quality of titles, and level of detail for tasks.
 */
export const FEW_SHOT_EXAMPLE = `Example output (for reference — do NOT include this example in your response):
[
  {
    "epic": { "title": "User Authentication" },
    "features": [
      {
        "title": "OAuth2 Integration",
        "description": "Support third-party OAuth2 providers for user login",
        "tasks": [
          {
            "title": "Implement OAuth2 callback handler",
            "description": "Handle the authorization code exchange and token storage after provider redirects back to our app",
            "acceptanceCriteria": [
              "Handles Google OAuth2 flow end-to-end",
              "Stores refresh token securely",
              "Returns meaningful error on provider rejection"
            ],
            "priority": "high",
            "tags": ["auth", "backend"]
          }
        ]
      }
    ]
  }
]`;

// ── Scan result summarization + chunking ──

/**
 * Character budget per LLM chunk. Keeps each prompt well within token limits
 * while leaving room for the system instructions, existing PRD summary, and
 * project context that surround the scan data.
 */
export const CHUNK_CHAR_LIMIT = 40_000;

/**
 * Render an array of ScanResults into the text block used inside LLM prompts.
 */
export function summarizeScanResults(results: ScanResult[]): string {
  return results
    .map((r) => {
      const parts = [
        `[${r.kind}] ${r.name} (source: ${r.source}, file: ${r.sourceFile})`,
      ];
      if (r.description) parts.push(`  description: ${r.description}`);
      if (r.acceptanceCriteria?.length)
        parts.push(`  criteria: ${r.acceptanceCriteria.join("; ")}`);
      if (r.priority) parts.push(`  priority: ${r.priority}`);
      if (r.tags?.length) parts.push(`  tags: ${r.tags.join(", ")}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

/**
 * Split scan results into chunks whose serialised summary stays within
 * `CHUNK_CHAR_LIMIT`. When all results fit in a single chunk, this returns
 * a one-element array — no overhead.
 */
export function chunkScanResults(results: ScanResult[]): ScanResult[][] {
  if (results.length === 0) return [];

  const chunks: ScanResult[][] = [];
  let current: ScanResult[] = [];
  let currentLen = 0;

  for (const r of results) {
    const itemText = summarizeScanResults([r]);
    const itemLen = itemText.length;

    // If adding this item would exceed the limit, flush the current chunk
    // (unless it's empty — an oversized single item gets its own chunk).
    if (current.length > 0 && currentLen + itemLen + 2 > CHUNK_CHAR_LIMIT) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }

    current.push(r);
    currentLen += itemLen + 2; // account for the "\n\n" separator
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

// ── Public API ──

export async function reasonFromFile(
  filePath: string,
  existingItems: PRDItem[],
  model?: string,
): Promise<Proposal[]> {
  const content = await readFile(filePath, "utf-8");
  const format = detectFileFormat(filePath);

  // For JSON/YAML, try direct structured parsing first
  if (format !== "markdown") {
    const structured = parseStructuredFile(content, format, existingItems);
    if (structured !== null) {
      return structured;
    }
  }

  // Fall back to LLM-based extraction
  const existingSummary = summarizeExisting(existingItems);

  const prompt = `You are a product requirements analyst. Read the following document and extract a structured PRD (Product Requirements Document) as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

${FEW_SHOT_EXAMPLE}

Guidelines:
- Group related items into epics and features logically
- Derive tasks from actionable items in the document
- Every task MUST have either a description or acceptanceCriteria (preferably both)
- Task titles must be specific and actionable (verb-first, e.g. "Implement X", "Add Y")
- Each task should represent a single unit of work completable in one session
- Assign priority based on: blocking dependencies → user-facing impact → technical debt
- Do NOT include items that duplicate anything already in the existing PRD

${FORMAT_HINTS[format]}

Existing PRD:
${existingSummary}

Document to analyze:
${content}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;

  const raw = await spawnClaude(prompt, model ?? DEFAULT_MODEL);
  return parseProposalResponse(raw);
}

// ── Multi-file support ──

/**
 * Merge proposals that share the same epic title (case-insensitive).
 * Features and tasks are concatenated; duplicates within features are
 * removed by normalized title.
 */
export function mergeProposals(all: Proposal[]): Proposal[] {
  const epicMap = new Map<string, Proposal>();

  for (const p of all) {
    const key = normalize(p.epic.title);
    const existing = epicMap.get(key);
    if (!existing) {
      // Clone to avoid mutating inputs
      epicMap.set(key, {
        epic: { ...p.epic },
        features: p.features.map((f) => ({
          ...f,
          tasks: [...f.tasks],
        })),
      });
    } else {
      // Merge features into existing epic
      const seenFeatures = new Set(
        existing.features.map((f) => normalize(f.title)),
      );
      for (const f of p.features) {
        const fKey = normalize(f.title);
        if (seenFeatures.has(fKey)) {
          // Merge tasks into existing feature
          const target = existing.features.find(
            (ef) => normalize(ef.title) === fKey,
          )!;
          const seenTasks = new Set(
            target.tasks.map((t) => normalize(t.title)),
          );
          for (const t of f.tasks) {
            if (!seenTasks.has(normalize(t.title))) {
              target.tasks.push(t);
              seenTasks.add(normalize(t.title));
            }
          }
        } else {
          existing.features.push({ ...f, tasks: [...f.tasks] });
          seenFeatures.add(fKey);
        }
      }
    }
  }

  return [...epicMap.values()];
}

/**
 * Process multiple input files and combine results into a single proposal list.
 * Each file is read and parsed independently, then proposals are merged by epic.
 */
export async function reasonFromFiles(
  filePaths: string[],
  existingItems: PRDItem[],
  model?: string,
): Promise<Proposal[]> {
  if (filePaths.length === 0) {
    return [];
  }
  if (filePaths.length === 1) {
    return reasonFromFile(filePaths[0], existingItems, model);
  }

  const allProposals: Proposal[] = [];

  for (const fp of filePaths) {
    const proposals = await reasonFromFile(fp, existingItems, model);
    allProposals.push(...proposals);
  }

  return mergeProposals(allProposals);
}

export async function reasonFromScanResults(
  results: ScanResult[],
  existingItems: PRDItem[],
  options?: { model?: string; dir?: string },
): Promise<Proposal[]> {
  const existingSummary = summarizeExisting(existingItems);

  // Read project documentation for additional context
  const projectContext = options?.dir
    ? await readProjectContext(options.dir)
    : "";

  const contextBlock = projectContext
    ? `\nProject context (from documentation):\n${projectContext}\n`
    : "";

  // Split large result sets into chunks to stay within token limits
  const chunks = chunkScanResults(results);

  if (chunks.length === 0) {
    return [];
  }

  const model = options?.model ?? DEFAULT_MODEL;
  const allProposals: Proposal[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const scanSummary = summarizeScanResults(chunks[i]);

    // Multi-chunk context: include epic titles from previous chunks so the
    // LLM can reuse existing groupings instead of creating duplicates
    let chunkNote = "";
    if (chunks.length > 1) {
      chunkNote = `\nNote: This is chunk ${i + 1} of ${chunks.length}. Focus only on the scan results shown here.`;
      if (i > 0 && allProposals.length > 0) {
        const priorEpics = [...new Set(allProposals.map((p) => p.epic.title))];
        chunkNote += `\nEpics created from previous chunks (reuse these names where items belong to the same area):\n${priorEpics.map((e) => `  - ${e}`).join("\n")}`;
      }
      chunkNote += "\n";
    }

    const prompt = `You are a product requirements analyst. Given the following raw scan results from automated code analysis, organize them into a clean, well-structured PRD as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

${FEW_SHOT_EXAMPLE}

Guidelines:
- Near-duplicate items have already been merged. Focus on semantic grouping and structure.
- If any remaining items are clearly about the same thing, merge them into a single item.
- Create meaningful epic groupings (not just "Tests" or "Documentation")
- Rewrite vague titles to be clear and actionable (verb-first, e.g. "Implement X", "Add Y")
- Every task MUST have either a description or acceptanceCriteria (preferably both)
- Each task should represent a single unit of work completable in one session
- Preserve priority levels from the scan results
- Assign priority based on: blocking dependencies → user-facing impact → technical debt
- Do NOT include items that duplicate anything in the existing PRD
- Use the project context below to understand the project's purpose, architecture, and terminology; align epic/feature names with the project's domain
${chunkNote}${contextBlock}
Existing PRD:
${existingSummary}

Scan results:
${scanSummary}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;

    const raw = await spawnClaude(prompt, model);
    allProposals.push(...parseProposalResponse(raw));
  }

  // When we made multiple LLM calls, merge overlapping epics/features
  if (chunks.length > 1) {
    return mergeProposals(allProposals);
  }

  return allProposals;
}

// ── Natural-language add ──

export interface AddPromptOptions {
  parentId?: string;
}

/**
 * Build the LLM prompt for a natural-language add command.
 * Exported separately so it can be tested without spawning claude.
 */
export async function buildAddPrompt(
  description: string,
  existingItems: PRDItem[],
  dir: string,
  options?: AddPromptOptions,
): Promise<string> {
  const existingSummary = summarizeExisting(existingItems);
  const projectContext = await readProjectContext(dir);

  const contextBlock = projectContext
    ? `\nProject context (from documentation):\n${projectContext}\n`
    : "";

  let parentConstraint = "";
  if (options?.parentId) {
    // Find the parent in the tree and describe it
    const parentEntry = findItemInTree(existingItems, options.parentId);
    if (parentEntry) {
      parentConstraint = `
IMPORTANT: Scope your response to fit under this existing parent item:
  ID: ${options.parentId}
  Level: ${parentEntry.level}
  Title: ${parentEntry.title}

Only create children appropriate for a ${parentEntry.level}. For example, if the parent is an epic, create features and tasks. If the parent is a feature, create only tasks.
Do NOT create a new epic — instead use the parent's title as the epic title in your response.`;
    }
  }

  return `You are a product requirements analyst. Given the following natural-language description, create a structured PRD breakdown as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

${FEW_SHOT_EXAMPLE}

Guidelines:
- Break the description into a logical hierarchy of epics, features, and tasks
- Task titles must be specific and actionable (verb-first, e.g. "Implement X", "Add Y")
- Every task MUST have either a description or acceptanceCriteria (preferably both)
- Each task should represent a single unit of work completable in one session
- Add acceptance criteria where requirements are clear
- Assign priority based on: blocking dependencies → user-facing impact → technical debt
- Group related work into features under appropriate epics
- Do NOT include items that duplicate anything already in the existing PRD below
- Use the project context to understand terminology and architecture
${parentConstraint}
${contextBlock}
Existing PRD:
${existingSummary}

Description to add:
${description}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;
}

function findItemInTree(
  items: PRDItem[],
  id: string,
): PRDItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findItemInTree(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Send a natural-language description to the LLM and get back structured proposals.
 */
export async function reasonFromDescription(
  description: string,
  existingItems: PRDItem[],
  options?: { model?: string; dir?: string; parentId?: string },
): Promise<Proposal[]> {
  const dir = options?.dir ?? process.cwd();
  const prompt = await buildAddPrompt(description, existingItems, dir, {
    parentId: options?.parentId,
  });

  const raw = await spawnClaude(prompt, options?.model ?? DEFAULT_MODEL);
  return parseProposalResponse(raw);
}

// ── Ideas file import ──

/**
 * Build an LLM prompt for structuring freeform brainstorming notes into PRD
 * proposals. Distinct from `buildAddPrompt` (single description) and
 * `reasonFromFile` (formal spec import via analyze): this prompt is tuned for
 * rough, unstructured idea dumps.
 */
export async function buildIdeasPrompt(
  content: string,
  existingItems: PRDItem[],
  dir: string,
  options?: AddPromptOptions,
): Promise<string> {
  const existingSummary = summarizeExisting(existingItems);
  const projectContext = await readProjectContext(dir);

  const contextBlock = projectContext
    ? `\nProject context (from documentation):\n${projectContext}\n`
    : "";

  let parentConstraint = "";
  if (options?.parentId) {
    const parentEntry = findItemInTree(existingItems, options.parentId);
    if (parentEntry) {
      parentConstraint = `
IMPORTANT: Scope your response to fit under this existing parent item:
  ID: ${options.parentId}
  Level: ${parentEntry.level}
  Title: ${parentEntry.title}

Only create children appropriate for a ${parentEntry.level}. For example, if the parent is an epic, create features and tasks. If the parent is a feature, create only tasks.
Do NOT create a new epic — instead use the parent's title as the epic title in your response.`;
    }
  }

  return `You are a product requirements analyst. You are reading freeform brainstorming notes — rough ideas, bullet points, stream-of-consciousness thoughts, and informal descriptions. Your job is to distill ALL of these ideas into a well-structured PRD as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

${FEW_SHOT_EXAMPLE}

Guidelines:
- These are rough notes, not a formal specification. Extract the intent behind each idea.
- Capture EVERY idea mentioned, even brief or vague ones — flesh them out into actionable tasks.
- Group related ideas into logical epics and features.
- Task titles must be specific and actionable (verb-first, e.g. "Implement X", "Add Y").
- Every task MUST have either a description or acceptanceCriteria (preferably both).
- Each task should represent a single unit of work completable in one session.
- Assign priority based on: blocking dependencies → user-facing impact → technical debt.
- If an idea is ambiguous, interpret it reasonably and note assumptions in the description.
- Do NOT include items that duplicate anything already in the existing PRD below.
- Use the project context to understand terminology and architecture.
${parentConstraint}
${contextBlock}
Existing PRD:
${existingSummary}

Brainstorming notes:
${content}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;
}

/**
 * Read one or more freeform idea files and structure them into proposals via
 * LLM. Unlike `reasonFromFile` / `reasonFromFiles` (used by `analyze --file`
 * for formal spec import), this function uses a prompt specifically tuned for
 * rough brainstorming notes.
 */
export async function reasonFromIdeasFile(
  filePaths: string[],
  existingItems: PRDItem[],
  options?: { model?: string; dir?: string; parentId?: string },
): Promise<Proposal[]> {
  if (filePaths.length === 0) return [];

  const dir = options?.dir ?? process.cwd();

  // Read and concatenate all idea files
  const sections: string[] = [];
  for (const fp of filePaths) {
    const content = await readFile(fp, "utf-8");
    if (content.trim().length === 0) continue;
    if (filePaths.length > 1) {
      sections.push(`--- ${fp} ---\n${content.trim()}`);
    } else {
      sections.push(content.trim());
    }
  }

  if (sections.length === 0) return [];

  const combined = sections.join("\n\n");
  const prompt = await buildIdeasPrompt(combined, existingItems, dir, {
    parentId: options?.parentId,
  });

  const raw = await spawnClaude(prompt, options?.model ?? DEFAULT_MODEL);
  return parseProposalResponse(raw);
}
