/**
 * Stale project detection for n-dx.
 *
 * Checks a project directory for setup issues that suggest re-initialization:
 *   1. Missing .sourcevision/, .rex/, or .hench/ directories
 *   2. Schema version mismatches in manifest.json, prd.json, or config.json
 *   3. Missing required config keys added in newer versions of n-dx
 *
 * Design principles:
 * - Never throws — all errors are swallowed and return empty results.
 * - Synchronous file I/O only (no network calls, no async).
 * - Called early in the CLI dispatch loop before commands run.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Current rex schema identifier (see packages/rex/src/schema/v1.ts). */
export const EXPECTED_REX_SCHEMA = "rex/v1";

/** Current sourcevision schema version (see packages/sourcevision/src/schema/v1.ts). */
export const EXPECTED_SV_SCHEMA = "1.0.0";

/** Current hench schema identifier (see packages/hench/src/schema/v1.ts). */
export const EXPECTED_HENCH_SCHEMA = "hench/v1";

/**
 * Required top-level keys in .n-dx.json.
 * Any project missing these was initialized with an older version of n-dx.
 */
const REQUIRED_NDX_KEYS = ["llm"];

/**
 * Required top-level keys in .rex/config.json.
 */
const REQUIRED_REX_CONFIG_KEYS = ["schema", "project", "adapter"];

/**
 * @typedef {
 *   { type: 'missing_dirs'; dirs: string[] } |
 *   { type: 'schema_mismatch'; file: string; found: string; expected: string } |
 *   { type: 'missing_config_keys'; file: string; keys: string[] }
 * } StaleIssue
 */

/**
 * Check whether a rex schema version string is compatible with the current
 * expected schema. Forward-compatible minor versions are allowed —
 * e.g. "rex/v1.1" is compatible with "rex/v1".
 *
 * @param {string} version
 * @returns {boolean}
 */
function isCompatibleRexSchema(version) {
  return (
    version === EXPECTED_REX_SCHEMA ||
    version.startsWith(EXPECTED_REX_SCHEMA + ".")
  );
}

/**
 * Read and parse a JSON file synchronously.
 * Returns null on any error (missing file, parse error, permission denied, etc.).
 *
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function readJSON(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Check a project directory for stale or incomplete n-dx setup.
 *
 * Performs synchronous file I/O only. Never throws.
 *
 * @param {string} projectDir - Path to the project root
 * @returns {{ issues: StaleIssue[]; initVersion: string | null }}
 */
export function checkProjectHealth(projectDir) {
  /** @type {StaleIssue[]} */
  const issues = [];

  // ── 1. Missing directories ─────────────────────────────────────────────────
  const allDirs = [".sourcevision", ".rex", ".hench"];
  const missingDirs = allDirs.filter((d) => !existsSync(join(projectDir, d)));
  if (missingDirs.length > 0) {
    issues.push({ type: "missing_dirs", dirs: missingDirs });
  }
  const presentDirs = new Set(
    allDirs.filter((d) => !missingDirs.includes(d)),
  );

  // ── 2. Rex schema and config key checks ────────────────────────────────────
  if (presentDirs.has(".rex")) {
    // Check prd.json schema version
    const prd = readJSON(join(projectDir, ".rex", "prd.json"));
    if (prd?.schema !== undefined && !isCompatibleRexSchema(String(prd.schema))) {
      issues.push({
        type: "schema_mismatch",
        file: ".rex/prd.json",
        found: String(prd.schema),
        expected: EXPECTED_REX_SCHEMA,
      });
    }

    // Check .rex/config.json for required keys
    const rexConfig = readJSON(join(projectDir, ".rex", "config.json"));
    if (rexConfig !== null) {
      const missingKeys = REQUIRED_REX_CONFIG_KEYS.filter((k) => !(k in rexConfig));
      if (missingKeys.length > 0) {
        issues.push({
          type: "missing_config_keys",
          file: ".rex/config.json",
          keys: missingKeys,
        });
      }
    }
  }

  // ── 3. SourceVision schema check ──────────────────────────────────────────
  if (presentDirs.has(".sourcevision")) {
    const manifest = readJSON(
      join(projectDir, ".sourcevision", "manifest.json"),
    );
    if (
      manifest?.schemaVersion !== undefined &&
      manifest.schemaVersion !== EXPECTED_SV_SCHEMA
    ) {
      issues.push({
        type: "schema_mismatch",
        file: ".sourcevision/manifest.json",
        found: String(manifest.schemaVersion),
        expected: EXPECTED_SV_SCHEMA,
      });
    }
  }

  // ── 4. Hench schema check ─────────────────────────────────────────────────
  if (presentDirs.has(".hench")) {
    const henchConfig = readJSON(
      join(projectDir, ".hench", "config.json"),
    );
    if (
      henchConfig?.schema !== undefined &&
      henchConfig.schema !== EXPECTED_HENCH_SCHEMA
    ) {
      issues.push({
        type: "schema_mismatch",
        file: ".hench/config.json",
        found: String(henchConfig.schema),
        expected: EXPECTED_HENCH_SCHEMA,
      });
    }
  }

  // ── 5. .n-dx.json: init version and required keys ─────────────────────────
  let initVersion = null;
  const ndxConfig = readJSON(join(projectDir, ".n-dx.json"));
  if (ndxConfig !== null) {
    initVersion =
      typeof ndxConfig.initVersion === "string" ? ndxConfig.initVersion : null;

    const missingKeys = REQUIRED_NDX_KEYS.filter((k) => !(k in ndxConfig));
    if (missingKeys.length > 0) {
      issues.push({
        type: "missing_config_keys",
        file: ".n-dx.json",
        keys: missingKeys,
      });
    }
  }

  return { issues, initVersion };
}

/**
 * Format a stale-project suggestion message from a list of issues.
 * Returns null when there are no issues.
 *
 * The returned string is suitable for printing to stderr.
 *
 * @param {StaleIssue[]} issues
 * @param {string | null} initVersion - n-dx version recorded at init time
 * @returns {string | null}
 */
export function formatStaleSuggestion(issues, initVersion) {
  if (issues.length === 0) return null;

  const header = initVersion
    ? `\u26a0  Project was initialized with n-dx ${initVersion} \u2014 run \`ndx init\` to update`
    : `\u26a0  Project setup is incomplete or stale \u2014 run \`ndx init\` to update`;

  const details = issues.flatMap((issue) => {
    if (issue.type === "missing_dirs") {
      return [`   Missing: ${issue.dirs.join(", ")}`];
    }
    if (issue.type === "schema_mismatch") {
      return [
        `   Schema mismatch in ${issue.file}: found "${issue.found}", expected "${issue.expected}"`,
      ];
    }
    if (issue.type === "missing_config_keys") {
      return [
        `   Missing config keys in ${issue.file}: ${issue.keys.join(", ")}`,
      ];
    }
    return [];
  });

  return [header, ...details].join("\n");
}
