/**
 * Config surface analyzer — Phase 7.
 *
 * Scans source files for:
 * - Environment variable reads (process.env.* for JS/TS, os.Getenv/os.LookupEnv for Go)
 * - Go struct env tags (env:"VAR")
 * - Go viper config reads (viper.GetString, viper.SetDefault, viper.BindEnv)
 * - Go flag definitions (flag.String, pflag.IntP, etc.)
 * - Config file references (.env, .env.*, config.json, config.yaml, *.toml)
 * - Exported constant definitions (export const in TS/JS, capitalized const in Go)
 * - Vite/esbuild define replacements (define: { 'KEY': value })
 * - Config JSON file fields (.hench/config.json, .rex/config.json) with current values
 *
 * Produces config-surface.json alongside other phase outputs.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Inventory, FileEntry } from "../schema/v1.js";
import type {
  ConfigSurface,
  ConfigSurfaceEntry,
  ConfigSurfaceSummary,
} from "../schema/v1.js";

// ── Pattern definitions ──────────────────────────────────────────────

/** Regex patterns for env var reads in JavaScript/TypeScript. */
const TS_ENV_PATTERNS = [
  // process.env.VAR_NAME or process.env["VAR_NAME"] or process.env['VAR_NAME']
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\["([A-Z_][A-Z0-9_]*)"\]/g,
  /process\.env\['([A-Z_][A-Z0-9_]*)'\]/g,
  // Destructured: const { VAR } = process.env
  /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*process\.env/g,
  // import.meta.env.VAR_NAME (Vite-style)
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
];

/** Regex patterns for env var reads in Go. */
const GO_ENV_PATTERNS = [
  // os.Getenv("VAR_NAME")
  /os\.Getenv\("([^"]+)"\)/g,
  // os.LookupEnv("VAR_NAME")
  /os\.LookupEnv\("([^"]+)"\)/g,
  // struct env tags: `env:"VAR_NAME"`
  /`[^`]*\benv:"([^"]+)"[^`]*`/g,
];

/** Regex patterns for viper config reads in Go. */
const GO_VIPER_PATTERNS = [
  // viper.Get("key"), viper.GetString("key"), viper.GetInt("key"), etc.
  /viper\.Get(?:String|Int|Bool|Float64|Duration|StringSlice|IntSlice|StringMap|StringMapString|SizeInBytes|Time)?\("([^"]+)"\)/g,
  // viper.SetDefault("key", value)
  /viper\.SetDefault\("([^"]+)"/g,
  // viper.BindEnv("KEY")
  /viper\.BindEnv\("([^"]+)"/g,
  // viper.IsSet("key")
  /viper\.IsSet\("([^"]+)"\)/g,
];

/** Regex patterns for flag/pflag definitions in Go. */
const GO_FLAG_PATTERNS = [
  // flag.String("name", ...) / flag.StringVar(&v, "name", ...)
  // pflag.String("name", ...) / pflag.StringP("name", ...) / pflag.BoolVar(&v, "name", ...)
  /(?:flag|pflag)\.\w+\((?:&[\w.]+\s*,\s*)?["']([^"']+)["']/g,
];

/** Config file patterns to detect references. */
const CONFIG_FILE_PATTERNS = [
  /(?:["'`])(\.[/\\]?\.env(?:\.[a-zA-Z0-9.]+)?)["'`]/g,
  /(?:["'`])(\.[/\\]?config\.(?:json|yaml|yml|toml))["'`]/g,
  /(?:["'`])(\.[/\\]?\.config\.(?:json|yaml|yml|toml))["'`]/g,
  /(?:["'`])([^"'`]*\.env\.[a-zA-Z0-9]+)["'`]/g,
];

/** File extensions that can contain env var reads. */
const SCANNABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".go",
]);

/** File extensions for Go source. */
const GO_EXTENSIONS = new Set([".go"]);

// ── Core scanner ─────────────────────────────────────────────────────

interface ScanResult {
  envVars: ConfigSurfaceEntry[];
  configRefs: ConfigSurfaceEntry[];
  constants: ConfigSurfaceEntry[];
}

/**
 * Scan a single file for env var reads, config file references, and constants.
 */
function scanFile(absDir: string, file: FileEntry): ScanResult {
  const result: ScanResult = { envVars: [], configRefs: [], constants: [] };

  const ext = file.path.match(/\.[^.]+$/)?.[0] ?? "";
  if (!SCANNABLE_EXTENSIONS.has(ext)) return result;

  const filePath = join(absDir, file.path);
  if (!existsSync(filePath)) return result;

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return result;
  }

  const lines = content.split("\n");
  const isGo = GO_EXTENSIONS.has(ext);

  // Scan for env var reads
  const envPatterns = isGo ? GO_ENV_PATTERNS : TS_ENV_PATTERNS;
  for (const pattern of envPatterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;

      // Handle destructured env vars: const { A, B } = process.env
      if (match[0].includes("{") && !isGo) {
        const vars = match[1].split(",").map((v) => v.trim().split(/\s+as\s+/)[0].trim());
        for (const varName of vars) {
          if (varName && /^[A-Z_][A-Z0-9_]*$/.test(varName)) {
            result.envVars.push({
              name: varName,
              type: "env",
              file: file.path,
              line: lineNum,
              referencedBy: [],
            });
          }
        }
      } else {
        const name = match[1];
        if (name) {
          result.envVars.push({
            name,
            type: "env",
            file: file.path,
            line: lineNum,
            referencedBy: [],
          });
        }
      }
    }
  }

  // Scan for config file references
  for (const pattern of CONFIG_FILE_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      const refPath = match[1];
      if (refPath) {
        result.configRefs.push({
          name: refPath,
          type: "config",
          file: file.path,
          line: lineNum,
          referencedBy: [],
        });
      }
    }
  }

  // Scan for top-level constants (simplified heuristic)
  if (isGo) {
    scanGoConstants(content, lines, file.path, result);
    scanGoConfigReads(content, file.path, result);
  } else {
    scanTsConstants(content, lines, file.path, result);
    scanViteDefine(content, lines, file.path, result);
  }

  return result;
}

/**
 * Scan for exported top-level const declarations in TypeScript/JavaScript.
 * Only captures constants that are both module-level (not inside functions/classes)
 * and explicitly exported. Non-exported file-local constants are excluded — they
 * are not part of the project's configuration surface.
 */
function scanTsConstants(content: string, lines: string[], filePath: string, result: ScanResult): void {
  // Track brace depth to identify top-level scope
  let braceDepth = 0;
  let inTemplate = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    // Count braces (simplified — doesn't handle strings/comments perfectly)
    for (const ch of line) {
      if (ch === "`") inTemplate = !inTemplate;
      if (inTemplate) continue;
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
    }

    // Only capture module-level (top-level) constants
    if (braceDepth > 0) continue;

    // Match: export const NAME = VALUE (requires export keyword)
    const constMatch = trimmed.match(
      /^export\s+const\s+([A-Z_][A-Z0-9_]*)\s*(?::\s*[^=]+)?\s*=\s*(.+)/,
    );
    if (constMatch) {
      const [, name, rawValue] = constMatch;
      const value = extractStaticValue(rawValue);
      result.constants.push({
        name,
        type: "constant",
        file: filePath,
        line: i + 1,
        referencedBy: [],
        ...(value !== undefined ? { value } : {}),
      });
    }
  }
}

/**
 * Scan for exported module-level const declarations in Go.
 * In Go, identifiers starting with an uppercase letter are exported (visible
 * outside the package). Lowercase identifiers are package-private and excluded
 * from the config surface.
 */
function scanGoConstants(content: string, lines: string[], filePath: string, result: ScanResult): void {
  let inConstBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect const block start
    if (trimmed === "const (") {
      inConstBlock = true;
      continue;
    }

    if (inConstBlock) {
      if (trimmed === ")") {
        inConstBlock = false;
        continue;
      }

      // Match: NAME = VALUE or NAME type = VALUE
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(?:\w+\s+)?=\s*(.+)/);
      if (match) {
        const [, name, rawValue] = match;
        // Go visibility: only capitalized identifiers are exported
        if (!/^[A-Z]/.test(name)) continue;
        const value = extractStaticValue(rawValue);
        result.constants.push({
          name,
          type: "constant",
          file: filePath,
          line: i + 1,
          referencedBy: [],
          ...(value !== undefined ? { value } : {}),
        });
      }
      continue;
    }

    // Single-line const
    const singleMatch = trimmed.match(
      /^const\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:\w+\s+)?=\s*(.+)/,
    );
    if (singleMatch) {
      const [, name, rawValue] = singleMatch;
      // Go visibility: only capitalized identifiers are exported
      if (!/^[A-Z]/.test(name)) continue;
      const value = extractStaticValue(rawValue);
      result.constants.push({
        name,
        type: "constant",
        file: filePath,
        line: i + 1,
        referencedBy: [],
        ...(value !== undefined ? { value } : {}),
      });
    }
  }
}

/**
 * Scan Go files for viper config reads and flag definitions.
 * Produces "config" type entries for each detected key.
 */
function scanGoConfigReads(content: string, filePath: string, result: ScanResult): void {
  // Viper config reads
  for (const pattern of GO_VIPER_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      const name = match[1];
      if (name) {
        result.configRefs.push({
          name,
          type: "config",
          file: filePath,
          line: lineNum,
          referencedBy: [],
        });
      }
    }
  }

  // Flag/pflag definitions
  for (const pattern of GO_FLAG_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      const name = match[1];
      if (name) {
        result.configRefs.push({
          name,
          type: "config",
          file: filePath,
          line: lineNum,
          referencedBy: [],
        });
      }
    }
  }
}

/**
 * Scan TypeScript/JavaScript files for Vite/esbuild `define` blocks.
 * Only applies to files that contain `defineConfig` or are named like
 * build config files (vite.config.*, esbuild.config.*, etc.).
 * Produces "constant" type entries for each key in the define block.
 */
function scanViteDefine(content: string, lines: string[], filePath: string, result: ScanResult): void {
  // Only scan files that look like build config
  const isBuildConfig = /(?:vite|esbuild|rollup|webpack)\.config\./.test(filePath);
  const hasDefineConfig = /\bdefineConfig\s*\(/.test(content);
  if (!isBuildConfig && !hasDefineConfig) return;

  let inDefine = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    // Detect define block start: `define: {` or `define:{`
    if (!inDefine && /\bdefine\s*:\s*\{/.test(trimmed)) {
      inDefine = true;
      braceDepth = 0;
      // Count braces on this line to track nesting
      for (const ch of trimmed) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }
      // Extract keys from same line (after the opening brace)
      extractDefineKeys(trimmed, i + 1, filePath, result);
      if (braceDepth <= 0) inDefine = false;
      continue;
    }

    if (inDefine) {
      for (const ch of trimmed) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }

      extractDefineKeys(trimmed, i + 1, filePath, result);

      if (braceDepth <= 0) {
        inDefine = false;
      }
    }
  }
}

/**
 * Extract define replacement keys from a single line within a `define: {}` block.
 * Matches quoted strings before `:` (object keys).
 */
function extractDefineKeys(line: string, lineNum: number, filePath: string, result: ScanResult): void {
  const keyPattern = /['"]([^'"]+)['"]\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(line)) !== null) {
    const key = match[1];
    if (key) {
      result.constants.push({
        name: key,
        type: "constant",
        file: filePath,
        line: lineNum,
        referencedBy: [],
      });
    }
  }
}

/**
 * Extract a statically determinable value from a raw assignment RHS.
 * Returns the string/number/boolean value, or undefined if not static.
 */
function extractStaticValue(raw: string): string | undefined {
  const trimmed = raw.replace(/;$/, "").trim();

  // String literal
  const stringMatch = trimmed.match(/^["'`]([^"'`]*)["'`]$/);
  if (stringMatch) return stringMatch[1];

  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;

  // Boolean
  if (trimmed === "true" || trimmed === "false") return trimmed;

  return undefined;
}

// ── Config JSON scanner ──────────────────────────────────────────────

/**
 * Flatten a JSON object into dot-notated key/value pairs.
 * Nested objects are recursed; arrays and primitives become leaf entries.
 */
function flattenJsonEntries(
  obj: unknown,
  prefix: string,
): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  if (obj === null || obj === undefined) {
    out.push({ name: prefix, value: String(obj) });
    return out;
  }
  if (Array.isArray(obj)) {
    out.push({ name: prefix, value: JSON.stringify(obj) });
    return out;
  }
  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        out.push(...flattenJsonEntries(value, fullKey));
      } else {
        out.push(...flattenJsonEntries(value, fullKey));
      }
    }
    return out;
  }
  // Primitive: string, number, boolean
  out.push({ name: prefix, value: String(obj) });
  return out;
}

/**
 * Scan a config JSON file and return config surface entries for each field.
 * Returns an empty array if the file doesn't exist or can't be parsed.
 */
function scanConfigJsonFile(absDir: string, relPath: string): ConfigSurfaceEntry[] {
  const filePath = join(absDir, relPath);
  if (!existsSync(filePath)) return [];

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];

  const flat = flattenJsonEntries(parsed, "");
  return flat.map(({ name, value }) => ({
    name,
    type: "config" as const,
    file: relPath,
    line: 0,
    referencedBy: [],
    value,
  }));
}

// ── Public API ───────────────────────────────────────────────────────

export interface AnalyzeConfigSurfaceOptions {
  /** File-to-zone mapping for zone attribution. */
  fileToZone?: Map<string, string>;
  /** Relative paths to config JSON files to scan (e.g. .hench/config.json). */
  configJsonPaths?: string[];
}

/**
 * Analyze a project's configuration surface.
 *
 * Scans all source files in the inventory for env var reads, config file
 * references, and global constant definitions.
 */
export function analyzeConfigSurface(
  absDir: string,
  inventory: Inventory,
  options?: AnalyzeConfigSurfaceOptions,
): ConfigSurface {
  const fileToZone = options?.fileToZone;
  const configJsonPaths = options?.configJsonPaths;
  const allEnvVars: ConfigSurfaceEntry[] = [];
  const allConfigRefs: ConfigSurfaceEntry[] = [];
  const allConstants: ConfigSurfaceEntry[] = [];

  // Scan all source files
  for (const file of inventory.files) {
    if (file.role !== "source" && file.role !== "config") continue;

    const result = scanFile(absDir, file);

    // Add zone attribution if available
    const zone = fileToZone?.get(file.path);
    if (zone) {
      for (const entry of [...result.envVars, ...result.configRefs, ...result.constants]) {
        entry.referencedBy = [zone];
      }
    }

    allEnvVars.push(...result.envVars);
    allConfigRefs.push(...result.configRefs);
    allConstants.push(...result.constants);
  }

  // Scan config JSON files (e.g. .hench/config.json, .rex/config.json)
  if (configJsonPaths) {
    for (const relPath of configJsonPaths) {
      const entries = scanConfigJsonFile(absDir, relPath);
      allConfigRefs.push(...entries);
    }
  }

  // Deduplicate env vars by name, merging zone references
  const envVarMap = new Map<string, ConfigSurfaceEntry>();
  for (const entry of allEnvVars) {
    const existing = envVarMap.get(entry.name);
    if (existing) {
      // Keep first occurrence's file/line, merge zones
      for (const zone of entry.referencedBy) {
        if (!existing.referencedBy.includes(zone)) {
          existing.referencedBy.push(zone);
        }
      }
    } else {
      envVarMap.set(entry.name, { ...entry });
    }
  }

  // Combine all entries
  const entries: ConfigSurfaceEntry[] = [
    ...envVarMap.values(),
    ...allConfigRefs,
    ...allConstants,
  ];

  // Sort entries by type (env → config → constant), then name
  const TYPE_ORDER: Record<string, number> = { env: 0, config: 1, constant: 2 };
  entries.sort((a, b) => {
    const typeOrd = (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
    if (typeOrd !== 0) return typeOrd;
    return a.name.localeCompare(b.name);
  });

  const summary: ConfigSurfaceSummary = {
    totalEnvVars: envVarMap.size,
    totalConfigRefs: allConfigRefs.length,
    totalConstants: allConstants.length,
  };

  return { entries, summary };
}
