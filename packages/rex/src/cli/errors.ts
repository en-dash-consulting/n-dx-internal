/**
 * CLI error handling — user-friendly errors with optional suggestions.
 */

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
    /ENOENT.*\.rex/,
    "Rex directory not found.",
    "Run 'n-dx init' to set up the project.",
  ],
  [
    /ENOENT.*prd\.json/,
    "PRD file not found.",
    "Run 'n-dx init' to create the initial PRD.",
  ],
  [
    /ENOENT.*config\.json/,
    "Configuration file not found.",
    "Run 'n-dx init' to create default configuration.",
  ],
  [
    /Invalid prd\.json/,
    "PRD file is corrupted or has an invalid format.",
    "Check .rex/prd.json for syntax errors, or re-initialize with 'n-dx init'.",
  ],
  [
    /Invalid config\.json/,
    "Configuration file is corrupted.",
    "Check .rex/config.json for syntax errors, or re-initialize with 'n-dx init'.",
  ],
  [
    /EACCES/,
    "Permission denied.",
    "Check file permissions for the .rex/ directory.",
  ],
  [
    /Unexpected token/,
    "Failed to parse JSON file.",
    "Check for syntax errors in the file, or re-initialize with 'n-dx init'.",
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
