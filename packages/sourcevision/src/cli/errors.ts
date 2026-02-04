/**
 * CLI error handling — user-friendly errors with optional suggestions.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { SV_DIR } from "./commands/constants.js";

/** An error with an optional actionable suggestion for the user. */
export class CLIError extends Error {
  suggestion?: string;

  constructor(message: string, suggestion?: string) {
    super(message);
    this.name = "CLIError";
    this.suggestion = suggestion;
  }
}

/**
 * Known error patterns mapped to user-friendly messages and suggestions.
 * Each entry: [regex to match, user-friendly message, suggestion].
 */
const ERROR_HINTS: Array<[RegExp, string, string]> = [
  [
    /ENOENT.*\.sourcevision/,
    "Sourcevision directory not found.",
    "Run 'n-dx init' or 'sourcevision init' to set up analysis.",
  ],
  [
    /ENOENT.*manifest\.json/,
    "Sourcevision manifest not found.",
    "Run 'sourcevision analyze' to generate analysis output.",
  ],
  [
    /EACCES/,
    "Permission denied.",
    "Check file permissions for the .sourcevision/ directory.",
  ],
  [
    /Unexpected token/,
    "Failed to parse JSON file.",
    "Check for syntax errors in the file, or run 'sourcevision reset' to start fresh.",
  ],
  [
    /Directory not found/,
    "",  // Use original message
    "Check the path and try again.",
  ],
  [
    /ENOENT/,
    "File or directory not found.",
    "Check the path and try again.",
  ],
];

/**
 * Format an error for CLI output. Returns lines to print to stderr.
 * Never includes stack traces in the output.
 */
export function formatCLIError(err: unknown): string {
  // CLIError — already user-friendly
  if (err instanceof CLIError) {
    let msg = `Error: ${err.message}`;
    if (err.suggestion) {
      msg += `\nHint: ${err.suggestion}`;
    }
    return msg;
  }

  const message = err instanceof Error ? err.message : String(err);

  // Check for known patterns
  for (const [pattern, friendly, suggestion] of ERROR_HINTS) {
    if (pattern.test(message)) {
      const displayMsg = friendly || message;
      return `Error: ${displayMsg}\nHint: ${suggestion}`;
    }
  }

  // Generic fallback — show the message, never the stack
  return `Error: ${message}`;
}

/**
 * Handle a CLI error: print it and exit.
 * Drop-in replacement for catch blocks in CLI entry points.
 */
export function handleCLIError(err: unknown): never {
  console.error(formatCLIError(err));
  process.exit(1);
}

/**
 * Check that .sourcevision/ exists in the given directory.
 * Throws a CLIError with an init suggestion if missing.
 */
export function requireSvDir(dir: string): void {
  if (!existsSync(join(dir, SV_DIR))) {
    throw new CLIError(
      `Sourcevision directory not found in ${dir}`,
      "Run 'n-dx init' to set up the project, or 'sourcevision init' if using sourcevision standalone.",
    );
  }
}
