/**
 * Config surface analyzer — Phase 7.
 *
 * Scans source files for:
 * - Environment variable reads (process.env.* for JS/TS, os.Getenv/os.LookupEnv for Go)
 * - Config file references (.env, .env.*, config.json, config.yaml, *.toml)
 * - Exported constant definitions (export const in TS/JS, capitalized const in Go)
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
  } else {
    scanTsConstants(content, lines, file.path, result);
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

// ── Public API ───────────────────────────────────────────────────────

export interface AnalyzeConfigSurfaceOptions {
  /** File-to-zone mapping for zone attribution. */
  fileToZone?: Map<string, string>;
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
