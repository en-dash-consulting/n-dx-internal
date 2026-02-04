import { readFile, readdir, access } from "node:fs/promises";
import { join, relative, dirname, basename, extname } from "node:path";
import type { Priority } from "../schema/index.js";

export interface ScanResult {
  name: string;
  source: "test" | "doc" | "sourcevision" | "package";
  sourceFile: string;
  kind: "epic" | "feature" | "task";
  description?: string;
  acceptanceCriteria?: string[];
  priority?: Priority;
  tags?: string[];
}

export interface ScanOptions {
  lite?: boolean;
  /** Extra path prefixes or directory names to ignore in scanDocs */
  ignorePatterns?: string[];
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".rex",
  ".git",
  ".sourcevision",
  "coverage",
  ".next",
  ".turbo",
]);

/** Directories that contain generated output — not human-written docs */
const SKIP_DOC_DIRS = new Set([
  "build",
  "out",
  ".hench",
  ".cache",
  ".parcel-cache",
  ".vite",
  ".nuxt",
  ".svelte-kit",
  ".output",
  "tmp",
  "temp",
]);

/** File basenames that are auto-generated or machine config, not human docs */
const SKIP_DOC_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "shrinkwrap.json",
  "npm-shrinkwrap.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "jsconfig.json",
  ".eslintrc.json",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  "turbo.json",
]);

async function globFiles(
  dir: string,
  match: (rel: string) => boolean,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(join(current, entry.name));
        }
      } else if (entry.isFile()) {
        const rel = relative(dir, join(current, entry.name));
        if (match(rel)) {
          results.push(join(current, entry.name));
        }
      }
    }
  }

  await walk(dir);
  return results;
}

function isTestFile(rel: string): boolean {
  if (rel.includes("__tests__/")) return true;
  const base = basename(rel);
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(base);
}

function toTitleCase(str: string): string {
  return str
    .replace(/[-_./]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function inferEpicName(filePath: string, baseDir: string): string {
  const rel = relative(baseDir, filePath);
  const parts = dirname(rel).split("/").filter((p) => p !== "." && p !== "");
  // Skip common test root directories
  const meaningful = parts.filter(
    (p) =>
      !["tests", "test", "__tests__", "unit", "integration", "e2e", "spec"].includes(p),
  );
  if (meaningful.length > 0) {
    return toTitleCase(meaningful[0]);
  }
  return "General";
}

function featureNameFromFile(filePath: string): string {
  const base = basename(filePath);
  const name = base
    .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "")
    .replace(/\.(ts|tsx|js|jsx)$/, "");
  return toTitleCase(name);
}

/** A node in the describe-block tree */
interface DescribeNode {
  name: string;
  children: DescribeNode[];
  tests: string[];
}

/**
 * Parse test file content into a tree of describe blocks and their tests.
 * Uses brace-depth tracking (not regex alone) so nesting is preserved.
 */
function parseDescribeTree(content: string): { roots: DescribeNode[]; topLevelTests: string[] } {
  const roots: DescribeNode[] = [];
  const topLevelTests: string[] = [];
  const lines = content.split("\n");

  // Stack tracks current nesting: each entry is { node, braceDepth at open }
  const stack: { node: DescribeNode; openDepth: number }[] = [];
  let braceDepth = 0;

  for (const line of lines) {
    // Count braces on this line (outside of strings, roughly)
    // Good enough for well-formatted test files
    const strippedLine = stripStrings(line);

    // Check for describe block opening before counting braces
    const describeMatch = line.match(/describe\(\s*["'`]([^"'`]+)["'`]/);
    if (describeMatch) {
      const node: DescribeNode = { name: describeMatch[1], children: [], tests: [] };
      if (stack.length > 0) {
        stack[stack.length - 1].node.children.push(node);
      } else {
        roots.push(node);
      }
      // The opening brace for the describe callback is on this line (or will be)
      const openBraces = (strippedLine.match(/\{/g) || []).length;
      const closeBraces = (strippedLine.match(/\}/g) || []).length;
      braceDepth += openBraces - closeBraces;
      stack.push({ node, openDepth: braceDepth });
      continue;
    }

    // Check for it/test blocks
    const testMatch = line.match(/(?:it|test)\(\s*["'`]([^"'`]+)["'`]/);
    if (testMatch) {
      if (stack.length > 0) {
        stack[stack.length - 1].node.tests.push(testMatch[1]);
      } else {
        topLevelTests.push(testMatch[1]);
      }
    }

    // Update brace depth
    const openBraces = (strippedLine.match(/\{/g) || []).length;
    const closeBraces = (strippedLine.match(/\}/g) || []).length;
    braceDepth += openBraces - closeBraces;

    // Pop stack when we close back to where a describe opened
    while (stack.length > 0 && braceDepth < stack[stack.length - 1].openDepth) {
      stack.pop();
    }
  }

  return { roots, topLevelTests };
}

/** Strip string literals from a line to avoid counting braces inside strings */
function stripStrings(line: string): string {
  // Remove template literals, double-quoted, and single-quoted strings
  return line
    .replace(/`[^`]*`/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/'[^']*'/g, "");
}

/** Walk a describe tree and emit ScanResults with hierarchical paths */
function emitDescribeResults(
  node: DescribeNode,
  parentPath: string[],
  epicName: string,
  rel: string,
  featureName: string,
  results: ScanResult[],
): void {
  const currentPath = [...parentPath, node.name];
  const pathLabel = currentPath.join(" > ");

  // Emit a feature for this describe block (with nesting path)
  // Skip if it duplicates the file-level feature name
  if (pathLabel.toLowerCase() !== featureName.toLowerCase()) {
    results.push({
      name: pathLabel,
      source: "test",
      sourceFile: rel,
      kind: "feature",
      tags: [epicName],
    });
  }

  // Emit tasks under this describe block — tag with the describe path
  for (const testName of node.tests) {
    results.push({
      name: testName,
      source: "test",
      sourceFile: rel,
      kind: "task",
      acceptanceCriteria: [testName],
      tags: [pathLabel],
    });
  }

  // Recurse into children
  for (const child of node.children) {
    emitDescribeResults(child, currentPath, epicName, rel, featureName, results);
  }
}

export async function scanTests(
  dir: string,
  opts: ScanOptions = {},
): Promise<ScanResult[]> {
  const files = await globFiles(dir, isTestFile);
  const results: ScanResult[] = [];

  for (const filePath of files) {
    const rel = relative(dir, filePath);
    const epicName = inferEpicName(filePath, dir);
    const featureName = featureNameFromFile(filePath);

    // Always emit a feature-level result for the file itself
    results.push({
      name: featureName,
      source: "test",
      sourceFile: rel,
      kind: "feature",
      tags: [epicName],
    });

    if (opts.lite) continue;

    // Full mode: parse file contents
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    // Parse describe-block tree to produce hierarchical grouping
    const { roots, topLevelTests } = parseDescribeTree(content);

    // Emit results for each describe tree
    for (const root of roots) {
      emitDescribeResults(root, [], epicName, rel, featureName, results);
    }

    // Top-level tests (outside any describe block)
    for (const testName of topLevelTests) {
      results.push({
        name: testName,
        source: "test",
        sourceFile: rel,
        kind: "task",
        acceptanceCriteria: [testName],
        tags: [epicName],
      });
    }
  }

  return results;
}

function isDocFile(rel: string): boolean {
  const ext = extname(rel).toLowerCase();
  return [".md", ".txt", ".json", ".yaml", ".yml"].includes(ext);
}

/** Check whether a relative path lives under a generated directory or is a generated file */
function isGeneratedDoc(rel: string, extraIgnore: string[] = []): boolean {
  const base = basename(rel);

  // Skip known generated/config files
  if (SKIP_DOC_FILES.has(base)) return true;

  // Skip files inside generated output directories
  const parts = rel.split("/");
  for (const part of parts.slice(0, -1)) {
    if (SKIP_DOC_DIRS.has(part)) return true;
  }

  // Skip user-supplied ignore patterns (prefix match on relative path)
  for (const pattern of extraIgnore) {
    if (rel.startsWith(pattern) || rel.includes(`/${pattern}`)) return true;
  }

  return false;
}

function extractMarkdownHeadings(
  content: string,
): { heading: string; bullets: string[] }[] {
  const lines = content.split("\n");
  const sections: { heading: string; bullets: string[] }[] = [];
  let current: { heading: string; bullets: string[] } | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[1].trim(), bullets: [] };
      continue;
    }
    if (current) {
      const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
      if (bulletMatch) {
        current.bullets.push(bulletMatch[1].trim());
      }
    }
  }
  if (current) sections.push(current);
  return sections;
}

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
  // Simple YAML extraction: look for title/name fields
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

export async function scanDocs(
  dir: string,
  opts: ScanOptions = {},
): Promise<ScanResult[]> {
  const extraIgnore = opts.ignorePatterns ?? [];
  const files = await globFiles(dir, (rel) =>
    isDocFile(rel) && !isGeneratedDoc(rel, extraIgnore),
  );
  const results: ScanResult[] = [];

  for (const filePath of files) {
    const rel = relative(dir, filePath);
    const ext = extname(filePath).toLowerCase();

    if (opts.lite) {
      // Lite mode: just use filename as a feature name
      const name = basename(filePath, ext);
      if (name.toLowerCase() === "readme" || name.toLowerCase() === "changelog") continue;
      results.push({
        name: toTitleCase(name),
        source: "doc",
        sourceFile: rel,
        kind: "feature",
      });
      continue;
    }

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    if (ext === ".md" || ext === ".txt") {
      const sections = extractMarkdownHeadings(content);
      for (const section of sections) {
        results.push({
          name: section.heading,
          source: "doc",
          sourceFile: rel,
          kind: "feature",
          acceptanceCriteria:
            section.bullets.length > 0 ? section.bullets : undefined,
        });
        for (const bullet of section.bullets) {
          results.push({
            name: bullet,
            source: "doc",
            sourceFile: rel,
            kind: "task",
          });
        }
      }
    } else if (ext === ".json") {
      const items = extractJsonItems(content);
      for (const item of items) {
        results.push({
          name: item.name,
          source: "doc",
          sourceFile: rel,
          kind: "feature",
          description: item.description,
        });
      }
    } else if (ext === ".yaml" || ext === ".yml") {
      const items = extractYamlItems(content);
      for (const item of items) {
        results.push({
          name: item.name,
          source: "doc",
          sourceFile: rel,
          kind: "feature",
          description: item.description,
        });
      }
    }
  }

  return results;
}

// Canonical sourcevision schema (v1)
interface SVFinding {
  type: "observation" | "pattern" | "relationship" | "anti-pattern" | "suggestion";
  pass: number;
  scope: string;
  text: string;
  severity?: "info" | "warning" | "critical";
  related?: string[];
}

interface SVZone {
  id: string;
  name: string;
  description: string;
  files: string[];
  entryPoints: string[];
  cohesion: number;
  coupling: number;
  insights?: string[];
}

interface SVZonesData {
  zones: SVZone[];
  findings?: SVFinding[];
  insights?: string[];
}

// Legacy zone format (pre-v1)
interface LegacyZone {
  name: string;
  description?: string;
  insights?: string[];
  findings?: {
    severity: string;
    message: string;
    file?: string;
  }[];
}

// Canonical inventory schema
interface SVFileEntry {
  path: string;
  category: string;
  role: string;
}

interface SVInventoryData {
  files?: SVFileEntry[];
  // Legacy format
  byCategory?: Record<string, unknown>;
}

// Canonical imports schema
interface SVCircularDependency {
  cycle: string[];
}

interface SVImportsData {
  summary?: {
    circulars?: SVCircularDependency[];
  };
  // Legacy formats
  circularDependencies?: { from: string; to: string }[];
  circular?: string[][];
}

/** Map finding type to an actionable task prefix */
function findingPrefix(type: SVFinding["type"]): string {
  switch (type) {
    case "anti-pattern":
      return "Fix";
    case "suggestion":
      return "Implement";
    case "pattern":
      return "Refactor";
    case "observation":
    case "relationship":
    default:
      return "Investigate";
  }
}

export async function scanSourceVision(dir: string): Promise<ScanResult[]> {
  const svDir = join(dir, ".sourcevision");
  try {
    await access(svDir);
  } catch {
    return [];
  }

  const results: ScanResult[] = [];

  // Read zones.json — supports both canonical (v1) and legacy formats
  try {
    const raw = await readFile(join(svDir, "zones.json"), "utf-8");
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      // Legacy format: flat array of zones with inline findings
      processLegacyZones(parsed as LegacyZone[], results);
    } else {
      // Canonical format: { zones, findings, ... }
      const zonesData = parsed as SVZonesData;
      const zones = zonesData.zones ?? [];
      const zoneMap = new Map<string, SVZone>();

      for (const zone of zones) {
        zoneMap.set(zone.id, zone);
        const fileCount = zone.files?.length ?? 0;
        results.push({
          name: zone.name,
          source: "sourcevision",
          sourceFile: ".sourcevision/zones.json",
          kind: "feature",
          description: fileCount > 0
            ? `${zone.description} (${fileCount} files)`
            : zone.description,
          acceptanceCriteria: zone.insights,
        });
      }

      // Process top-level findings into actionable tasks
      if (zonesData.findings) {
        for (const finding of zonesData.findings) {
          // Skip findings with no severity — not yet triaged
          if (!finding.severity) continue;
          // Skip info-level observations/relationships — purely informational
          const infoOnly = finding.type === "observation" || finding.type === "relationship";
          if (finding.severity === "info" && infoOnly) continue;

          const priority: Priority =
            finding.severity === "critical"
              ? "critical"
              : finding.severity === "warning"
                ? "high"
                : "medium";

          const prefix = findingPrefix(finding.type);
          const zone = zoneMap.get(finding.scope);

          // Use first related file as sourceFile, fall back to zones.json
          const primaryFile = finding.related?.[0];
          const sourceFile = primaryFile ?? ".sourcevision/zones.json";

          // Build acceptance criteria from related file paths
          const criteria: string[] = [];
          if (finding.related && finding.related.length > 0) {
            criteria.push(
              `Affected files: ${finding.related.join(", ")}`,
            );
          }
          if (zone) {
            criteria.push(`Zone: ${zone.name} (${zone.files.length} files)`);
          }

          results.push({
            name: `${prefix}: ${finding.text}`,
            source: "sourcevision",
            sourceFile,
            kind: "task",
            priority,
            tags: zone ? [zone.name] : finding.scope !== "global" ? [finding.scope] : undefined,
            acceptanceCriteria: criteria.length > 0 ? criteria : undefined,
          });
        }
      }
    }
  } catch {
    // zones.json not found or invalid, skip
  }

  // Read inventory.json for epic groupings — supports canonical and legacy formats
  try {
    const raw = await readFile(join(svDir, "inventory.json"), "utf-8");
    const inventory: SVInventoryData = JSON.parse(raw);

    if (inventory.files && inventory.files.length > 0) {
      // Canonical format: group files by category
      const categoryFiles = new Map<string, string[]>();
      for (const entry of inventory.files) {
        if (!entry.category) continue;
        const list = categoryFiles.get(entry.category) ?? [];
        list.push(entry.path);
        categoryFiles.set(entry.category, list);
      }
      for (const [category, files] of categoryFiles) {
        const fileLabel = files.length === 1 ? "1 file" : `${files.length} files`;
        results.push({
          name: toTitleCase(category),
          source: "sourcevision",
          sourceFile: ".sourcevision/inventory.json",
          kind: "epic",
          description: `${toTitleCase(category)} (${fileLabel})`,
        });
      }
    } else if (inventory.byCategory) {
      // Legacy format: byCategory object
      for (const category of Object.keys(inventory.byCategory)) {
        results.push({
          name: toTitleCase(category),
          source: "sourcevision",
          sourceFile: ".sourcevision/inventory.json",
          kind: "epic",
        });
      }
    }
  } catch {
    // inventory.json not found or invalid, skip
  }

  // Read imports.json for circular dependencies — supports canonical and legacy formats
  try {
    const raw = await readFile(join(svDir, "imports.json"), "utf-8");
    const imports: SVImportsData = JSON.parse(raw);

    // Canonical format: summary.circulars[].cycle
    if (imports.summary?.circulars) {
      for (const dep of imports.summary.circulars) {
        const uniqueFiles = [...new Set(dep.cycle)];
        const label = uniqueFiles.join(" → ");
        results.push({
          name: `Resolve circular: ${label}`,
          source: "sourcevision",
          sourceFile: uniqueFiles[0] ?? ".sourcevision/imports.json",
          kind: "task",
          priority: "high",
          tags: ["tech-debt"],
          acceptanceCriteria: [
            `Break circular dependency cycle: ${dep.cycle.join(" → ")}`,
            ...uniqueFiles.map((f) => `File: ${f}`),
          ],
        });
      }
    }

    // Legacy format: circularDependencies[].{from, to}
    if (imports.circularDependencies) {
      for (const dep of imports.circularDependencies) {
        results.push({
          name: `Resolve circular: ${dep.from} → ${dep.to}`,
          source: "sourcevision",
          sourceFile: ".sourcevision/imports.json",
          kind: "task",
          priority: "high",
          tags: ["tech-debt"],
        });
      }
    }

    // Legacy format: circular[][]
    if (imports.circular) {
      for (const cycle of imports.circular) {
        const label = cycle.join(" → ");
        results.push({
          name: `Resolve circular: ${label}`,
          source: "sourcevision",
          sourceFile: ".sourcevision/imports.json",
          kind: "task",
          priority: "high",
          tags: ["tech-debt"],
        });
      }
    }
  } catch {
    // imports.json not found or invalid, skip
  }

  return results;
}

// ── scanPackageJson ─────────────────────────────────────────────────

interface PackageJsonData {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
}

function isPackageJson(rel: string): boolean {
  return basename(rel) === "package.json";
}

export async function scanPackageJson(
  dir: string,
  opts: ScanOptions = {},
): Promise<ScanResult[]> {
  const files = await globFiles(dir, isPackageJson);
  const results: ScanResult[] = [];

  for (const filePath of files) {
    const rel = relative(dir, filePath);

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    let pkg: PackageJsonData;
    try {
      pkg = JSON.parse(content) as PackageJsonData;
    } catch {
      continue;
    }

    const pkgName = pkg.name ?? basename(dirname(filePath));
    const isRoot = rel === "package.json";

    if (opts.lite) {
      results.push({
        name: pkgName,
        source: "package",
        sourceFile: rel,
        kind: "feature",
      });
      continue;
    }

    // Emit a project epic for the package
    if (isRoot) {
      results.push({
        name: pkgName,
        source: "package",
        sourceFile: rel,
        kind: "epic",
        description: pkg.description,
      });
    }

    // Scripts → tasks
    if (pkg.scripts) {
      for (const [scriptName, command] of Object.entries(pkg.scripts)) {
        results.push({
          name: `Script: ${scriptName}`,
          source: "package",
          sourceFile: rel,
          kind: "task",
          description: command,
          tags: ["scripts"],
        });
      }
    }

    // Dependencies → feature summaries
    if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
      const count = Object.keys(pkg.dependencies).length;
      const depNames = Object.keys(pkg.dependencies).slice(0, 10);
      const suffix = count > 10 ? `, +${count - 10} more` : "";
      results.push({
        name: "Dependencies",
        source: "package",
        sourceFile: rel,
        kind: "feature",
        description: `${count} production ${count === 1 ? "dependency" : "dependencies"}: ${depNames.join(", ")}${suffix}`,
        tags: ["dependencies"],
      });
    }

    if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
      const count = Object.keys(pkg.devDependencies).length;
      const depNames = Object.keys(pkg.devDependencies).slice(0, 10);
      const suffix = count > 10 ? `, +${count - 10} more` : "";
      results.push({
        name: "Dev Dependencies",
        source: "package",
        sourceFile: rel,
        kind: "feature",
        description: `${count} dev ${count === 1 ? "dependency" : "dependencies"}: ${depNames.join(", ")}${suffix}`,
        tags: ["dependencies"],
      });
    }

    // Engines → tasks noting requirements
    if (pkg.engines) {
      for (const [engine, constraint] of Object.entries(pkg.engines)) {
        results.push({
          name: `Engine: ${engine} ${constraint}`,
          source: "package",
          sourceFile: rel,
          kind: "task",
          description: `Requires ${engine} ${constraint}`,
          tags: ["engines"],
        });
      }
    }
  }

  return results;
}

/** Process legacy zone format (flat array with inline findings) */
function processLegacyZones(
  zones: LegacyZone[],
  results: ScanResult[],
): void {
  for (const zone of zones) {
    results.push({
      name: zone.name,
      source: "sourcevision",
      sourceFile: ".sourcevision/zones.json",
      kind: "feature",
      description: zone.description,
      acceptanceCriteria: zone.insights,
    });

    if (zone.findings) {
      for (const finding of zone.findings) {
        const priority: Priority =
          finding.severity === "critical"
            ? "critical"
            : finding.severity === "warning"
              ? "high"
              : "medium";
        results.push({
          name: finding.message,
          source: "sourcevision",
          sourceFile: finding.file ?? ".sourcevision/zones.json",
          kind: "task",
          priority,
          tags: [zone.name],
        });
      }
    }
  }
}
