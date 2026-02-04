/**
 * Deterministic file inventory analyzer.
 * Replaces the Claude-based phase 1 with pure TypeScript.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, extname, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { FileEntry, FileRole, Inventory } from "../schema/index.js";
import { sortInventory, toCanonicalJSON } from "../util/sort.js";
import { computeInventorySummary } from "../util/merge.js";

// ── Skip patterns ────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".sourcevision",
  "dist",
  "build",
  "__pycache__",
  ".react-router",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  "coverage",
  ".output",
]);

// ── Language detection ───────────────────────────────────────────────────────

const EXT_TO_LANGUAGE: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".rb": "Ruby",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".scala": "Scala",
  ".swift": "Swift",
  ".c": "C",
  ".h": "C",
  ".cpp": "C++",
  ".cc": "C++",
  ".cxx": "C++",
  ".hpp": "C++",
  ".cs": "C#",
  ".php": "PHP",
  ".lua": "Lua",
  ".r": "R",
  ".R": "R",
  ".dart": "Dart",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".erl": "Erlang",
  ".hrl": "Erlang",
  ".hs": "Haskell",
  ".ml": "OCaml",
  ".mli": "OCaml",
  ".clj": "Clojure",
  ".cljs": "Clojure",
  ".zig": "Zig",
  ".v": "V",
  ".nim": "Nim",
  ".pl": "Perl",
  ".pm": "Perl",
  ".sh": "Shell",
  ".bash": "Shell",
  ".zsh": "Shell",
  ".fish": "Shell",
  ".html": "HTML",
  ".htm": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".sass": "SASS",
  ".less": "Less",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".toml": "TOML",
  ".xml": "XML",
  ".md": "Markdown",
  ".mdx": "Markdown",
  ".txt": "Text",
  ".rst": "reStructuredText",
  ".sql": "SQL",
  ".graphql": "GraphQL",
  ".gql": "GraphQL",
  ".proto": "Protobuf",
  ".svg": "SVG",
  ".wasm": "WebAssembly",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".astro": "Astro",
};

export function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext && EXT_TO_LANGUAGE[ext]) return EXT_TO_LANGUAGE[ext];

  // Filename-based detection
  const name = basename(filePath);
  if (name === "Makefile" || name === "GNUmakefile") return "Makefile";
  if (name === "Dockerfile" || name.startsWith("Dockerfile.")) return "Dockerfile";
  if (name === "Vagrantfile") return "Ruby";
  if (name === "Rakefile" || name === "Gemfile") return "Ruby";
  if (name === "Justfile") return "Just";
  if (name === "CMakeLists.txt" || ext === ".cmake") return "CMake";

  return "Other";
}

// ── Role classification ──────────────────────────────────────────────────────

const CONFIG_FILENAMES = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "jsconfig.json",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".prettierrc",
  ".prettierrc.js",
  ".prettierrc.json",
  ".prettierrc.yml",
  "prettier.config.js",
  "eslint.config.js",
  "eslint.config.mjs",
  ".editorconfig",
  ".gitignore",
  ".gitattributes",
  ".npmrc",
  ".npmignore",
  ".nvmrc",
  ".node-version",
  ".tool-versions",
  ".env.example",
  "babel.config.js",
  "babel.config.json",
  ".babelrc",
  "jest.config.js",
  "jest.config.ts",
  "vitest.config.ts",
  "vitest.config.js",
  "webpack.config.js",
  "rollup.config.js",
  "vite.config.ts",
  "vite.config.js",
  "esbuild.config.js",
  "postcss.config.js",
  "tailwind.config.js",
  "tailwind.config.ts",
  "next.config.js",
  "next.config.mjs",
  "nuxt.config.ts",
  "svelte.config.js",
  "astro.config.mjs",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "Pipfile",
  "Gemfile",
  "Gemfile.lock",
  "Rakefile",
  "composer.json",
  "composer.lock",
  "Makefile",
  "GNUmakefile",
  "CMakeLists.txt",
  "Justfile",
]);

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "Pipfile.lock",
  "poetry.lock",
  "go.sum",
  "flake.lock",
]);

const ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".avif",
  ".bmp",
  ".tiff",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".webm",
  ".pdf",
]);

const PROGRAMMING_LANGUAGES = new Set([
  "TypeScript",
  "JavaScript",
  "Python",
  "Ruby",
  "Go",
  "Rust",
  "Java",
  "Kotlin",
  "Scala",
  "Swift",
  "C",
  "C++",
  "C#",
  "PHP",
  "Lua",
  "R",
  "Dart",
  "Elixir",
  "Erlang",
  "Haskell",
  "OCaml",
  "Clojure",
  "Zig",
  "V",
  "Nim",
  "Perl",
  "Shell",
  "SQL",
  "Vue",
  "Svelte",
  "Astro",
]);

export function classifyRole(filePath: string, language: string): FileRole {
  const name = basename(filePath);
  const lower = filePath.toLowerCase();
  const ext = extname(filePath).toLowerCase();

  // 1. Test
  if (
    name.includes(".test.") ||
    name.includes(".spec.") ||
    lower.includes("__tests__/") ||
    lower.includes("/test/") ||
    lower.includes("/tests/") ||
    lower.startsWith("test/") ||
    lower.startsWith("tests/")
  ) {
    return "test";
  }

  // 2. Generated
  if (LOCKFILE_NAMES.has(name) || lower.includes("generated")) {
    return "generated";
  }

  // 3. Config
  if (
    CONFIG_FILENAMES.has(name) ||
    name.startsWith("tsconfig") ||
    (name.startsWith(".") && (name.endsWith("rc") || name.endsWith("rc.js") || name.endsWith("rc.json") || name.endsWith("rc.yml")))
  ) {
    return "config";
  }

  // 4. Docs
  if (
    language === "Markdown" ||
    language === "Text" ||
    language === "reStructuredText" ||
    lower.includes("/docs/") ||
    lower.startsWith("docs/") ||
    name === "LICENSE" ||
    name === "LICENSE.md" ||
    name === "CHANGELOG" ||
    name === "CHANGELOG.md" ||
    name === "CONTRIBUTING.md" ||
    name === "CODE_OF_CONDUCT.md"
  ) {
    return "docs";
  }

  // 5. Asset
  if (
    ASSET_EXTENSIONS.has(ext) ||
    lower.includes("/assets/") ||
    lower.startsWith("assets/") ||
    lower.includes("/public/") ||
    lower.startsWith("public/") ||
    lower.includes("/static/") ||
    lower.startsWith("static/")
  ) {
    return "asset";
  }

  // 6. Build
  if (
    lower.includes("/scripts/") ||
    lower.startsWith("scripts/") ||
    language === "Dockerfile" ||
    lower.includes(".github/workflows/") ||
    lower.includes(".github/actions/") ||
    name === "Makefile" ||
    name === "GNUmakefile" ||
    name === "Justfile"
  ) {
    return "build";
  }

  // 7. Source
  if (PROGRAMMING_LANGUAGES.has(language)) {
    return "source";
  }

  // 8. Fallback
  return "other";
}

// ── Category derivation ──────────────────────────────────────────────────────

const GENERIC_PREFIXES = new Set(["src", "lib", "app", "packages", "internal", "pkg"]);

export function deriveCategory(filePath: string): string {
  const parts = filePath.split("/");

  // Root files
  if (parts.length === 1) return "root";

  // Skip generic top-level prefixes
  let startIdx = 0;
  while (startIdx < parts.length - 1 && GENERIC_PREFIXES.has(parts[startIdx])) {
    startIdx++;
  }

  // If we ran out of meaningful segments, use last directory
  if (startIdx >= parts.length - 1) {
    // It's a file directly under generic prefix(es), use the prefix chain
    return parts.slice(0, -1).join("-").toLowerCase();
  }

  // Use the first meaningful directory segment
  return parts[startIdx].toLowerCase().replace(/[_\s]+/g, "-");
}

// ── Binary detection ─────────────────────────────────────────────────────────

export function isBinary(buf: Buffer): boolean {
  const check = buf.subarray(0, 8192);
  return check.includes(0);
}

// ── Ignore filter ────────────────────────────────────────────────────────────

interface IgnoreRule {
  regex: RegExp;
  negated: boolean;
  dirOnly: boolean;
}

function compilePattern(pattern: string): IgnoreRule {
  let negated = false;
  let dirOnly = false;

  // Leading ! means negation
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  }

  // Trailing / means directory-only
  if (pattern.endsWith("/")) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }

  // Leading / means anchored to root; otherwise matches at any depth
  const anchored = pattern.startsWith("/");
  if (anchored) {
    pattern = pattern.slice(1);
  }

  // Convert gitignore glob to regex
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          // **/ matches zero or more directories
          regex += "(?:.*/)?";
          i += 3;
          continue;
        }
        // ** at end or mid-pattern matches everything
        regex += ".*";
        i += 2;
        continue;
      }
      regex += "[^/]*";
      i++;
    } else if (ch === "?") {
      regex += "[^/]";
      i++;
    } else if (ch === "[") {
      // Pass through character classes
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) {
        regex += "\\[";
        i++;
      } else {
        regex += pattern.slice(i, close + 1);
        i = close + 1;
      }
    } else if (".+^${}()|\\".includes(ch)) {
      regex += "\\" + ch;
      i++;
    } else {
      regex += ch;
      i++;
    }
  }

  // If pattern contains a slash, it's always anchored
  const hasSlash = pattern.includes("/");
  if (anchored || hasSlash) {
    regex = "^" + regex;
  } else {
    // Matches at any depth: can appear after a /
    regex = "(?:^|/)" + regex;
  }

  regex += "$";

  return { regex: new RegExp(regex), negated, dirOnly };
}

export class IgnoreFilter {
  private rules: IgnoreRule[] = [];

  add(content: string): void {
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      this.rules.push(compilePattern(line));
    }
  }

  ignores(path: string): boolean {
    const isDir = path.endsWith("/");
    const testPath = isDir ? path.slice(0, -1) : path;

    let ignored = false;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.regex.test(testPath)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }
}

export async function loadIgnoreFilter(rootDir: string): Promise<IgnoreFilter> {
  const filter = new IgnoreFilter();

  for (const name of [".gitignore", ".sourcevisionignore"]) {
    try {
      const content = await readFile(join(rootDir, name), "utf-8");
      filter.add(content);
    } catch {
      // File doesn't exist — skip
    }
  }

  return filter;
}

// ── File discovery ───────────────────────────────────────────────────────────

async function walkDir(dir: string, rootDir: string, ig: IgnoreFilter): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      if (ig.ignores(relPath + "/")) continue;
      const sub = await walkDir(fullPath, rootDir, ig);
      files.push(...sub);
    } else if (entry.isFile()) {
      if (ig.ignores(relPath)) continue;
      files.push(relPath);
    }
  }

  return files;
}

// ── Incremental types ────────────────────────────────────────────────────────

export interface InventoryOptions {
  previousInventory?: Inventory;
}

export interface InventoryStats {
  cached: number;
  changed: number;
  added: number;
  deleted: number;
}

export interface InventoryResult extends Inventory {
  stats?: InventoryStats;
  changedFiles?: Set<string>;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function analyzeInventory(
  targetDir: string,
  options?: InventoryOptions
): Promise<InventoryResult> {
  const absDir = join(targetDir); // normalize
  const ig = await loadIgnoreFilter(absDir);
  const filePaths = await walkDir(absDir, absDir, ig);

  const prev = options?.previousInventory;
  const prevMap = new Map<string, FileEntry>();
  if (prev) {
    for (const f of prev.files) {
      prevMap.set(f.path, f);
    }
  }

  const files: FileEntry[] = [];
  const changedFiles = new Set<string>();
  let cached = 0;
  let changed = 0;
  let added = 0;

  for (const relPath of filePaths) {
    const fullPath = join(absDir, relPath);
    const st = await stat(fullPath);
    const mtime = Math.floor(st.mtimeMs);

    const prevEntry = prevMap.get(relPath);

    // If previous entry exists and mtime matches, reuse it
    if (prevEntry && prevEntry.lastModified === mtime) {
      files.push(prevEntry);
      cached++;
      continue;
    }

    // Otherwise, read and process the file
    const buf = await readFile(fullPath);
    const hash = createHash("sha256").update(buf).digest("hex");
    const language = detectLanguage(relPath);
    const role = classifyRole(relPath, language);
    const category = deriveCategory(relPath);

    let lineCount = 0;
    if (!isBinary(buf)) {
      const text = buf.toString("utf-8");
      if (text.length > 0) {
        lineCount = text.split("\n").length;
        if (text.endsWith("\n")) lineCount--;
      }
    }

    files.push({
      path: relPath,
      size: st.size,
      language,
      lineCount,
      hash,
      role,
      category,
      lastModified: mtime,
    });

    changedFiles.add(relPath);
    if (prevEntry) {
      changed++;
    } else {
      added++;
    }
  }

  // Detect deleted files
  const currentPaths = new Set(filePaths);
  let deleted = 0;
  if (prev) {
    for (const f of prev.files) {
      if (!currentPaths.has(f.path)) {
        deleted++;
      }
    }
  }

  const summary = computeInventorySummary(files);
  const result: InventoryResult = sortInventory({ files, summary }) as InventoryResult;

  if (prev) {
    result.stats = { cached, changed, added, deleted };
    result.changedFiles = changedFiles;
  }

  return result;
}

export { toCanonicalJSON };
