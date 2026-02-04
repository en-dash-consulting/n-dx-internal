/**
 * CLI error handling — user-friendly errors with optional suggestions.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { HENCH_DIR } from "./commands/constants.js";

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
    /ENOENT.*\.hench/,
    "Hench directory not found.",
    "Run 'n-dx init' to set up the project.",
  ],
  [
    /ENOENT.*\.rex/,
    "Rex directory not found.",
    "Run 'n-dx init' to set up the project.",
  ],
  [
    /ENOENT.*config\.json/,
    "Configuration file not found.",
    "Run 'n-dx init' to create default configuration.",
  ],
  [
    /EACCES/,
    "Permission denied.",
    "Check file permissions for the .hench/ directory.",
  ],
  [
    /Unexpected token/,
    "Failed to parse JSON file.",
    "Check for syntax errors in the file, or re-initialize with 'n-dx init'.",
  ],
  [
    /claude.*not found|ENOENT.*claude/i,
    "Claude CLI not found.",
    "Install the Claude CLI: https://docs.anthropic.com/en/docs/claude-cli",
  ],
  [
    /ANTHROPIC_API_KEY/,
    "Anthropic API key not configured.",
    "Set the ANTHROPIC_API_KEY environment variable, or use 'n-dx config hench.provider cli' for Claude CLI mode.",
  ],
  [
    /not found/i,
    "",  // Use original message
    "Check the ID or path and try again.",
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
 * Check that .hench/ exists in the given directory.
 * Throws a CLIError with an init suggestion if missing.
 */
export function requireHenchDir(dir: string): void {
  if (!existsSync(join(dir, HENCH_DIR))) {
    throw new CLIError(
      `Hench directory not found in ${dir}`,
      "Run 'n-dx init' to set up the project, or 'hench init' if using hench standalone.",
    );
  }
}
