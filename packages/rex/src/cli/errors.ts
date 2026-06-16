/**
 * CLI error handling — user-friendly errors with optional suggestions.
 *
 * Rex's CLIError extends the foundation CLIError from @n-dx/llm-client,
 * providing a consistent error hierarchy across all n-dx packages.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_ERROR_CODES,
  CLIError as BaseCLIError,
  type CLIErrorCode,
  colorWarn,
  isVerbose,
  formatVerboseLLMErrorDetails,
  mapCLICodeToErrorEntry,
} from "@n-dx/llm-client";
import { REX_DIR } from "./commands/constants.js";

/**
 * Rex CLI error — extends the foundation CLIError.
 *
 * Inherits from {@link BaseCLIError} (which extends ClaudeClientError),
 * so `instanceof ClaudeClientError` checks work across the entire error hierarchy.
 */
export class CLIError extends BaseCLIError {
  constructor(message: string, suggestion?: string, code?: CLIErrorCode) {
    super(message, suggestion, code);
    this.name = "CLIError";
  }
}

/**
 * Thrown when a budget threshold is exceeded and abort is configured.
 * Exit code 2 to distinguish from general errors (exit code 1).
 */
export class BudgetExceededError extends CLIError {
  exitCode = 2;

  constructor(warnings: string[]) {
    super(
      `Budget exceeded:\n  ${warnings.join("\n  ")}`,
      "Adjust budget with: n-dx config rex.budget.tokens <value> or rex.budget.cost <value>",
      CLI_ERROR_CODES.BUDGET_EXCEEDED,
    );
    this.name = "BudgetExceededError";
  }
}

/**
 * Known error patterns mapped to user-friendly messages and suggestions.
 * Each entry: [regex to match, stable code, user-friendly message, suggestion].
 */
const ERROR_HINTS: Array<[RegExp, CLIErrorCode, string, string]> = [
  [
    /ENOENT.*\.rex/,
    CLI_ERROR_CODES.NOT_INITIALIZED,
    "Rex directory not found.",
    "Run 'n-dx init' to set up the project.",
  ],
  [
    /ENOENT.*prd\.json/,
    CLI_ERROR_CODES.PRD_NOT_FOUND,
    "PRD file not found.",
    "Run 'n-dx init' to create the initial PRD.",
  ],
  [
    /ENOENT.*config\.json/,
    CLI_ERROR_CODES.CONFIG_NOT_FOUND,
    "Configuration file not found.",
    "Run 'n-dx init' to create default configuration.",
  ],
  [
    /Invalid prd\.json/,
    CLI_ERROR_CODES.INVALID_PRD,
    "PRD file is corrupted or has an invalid format.",
    "Check .rex/prd.json for syntax errors, or re-initialize with 'n-dx init'.",
  ],
  [
    /Invalid config\.json/,
    CLI_ERROR_CODES.INVALID_CONFIGURATION,
    "Configuration file is corrupted.",
    "Check .rex/config.json for syntax errors, or re-initialize with 'n-dx init'.",
  ],
  [
    /EACCES/,
    CLI_ERROR_CODES.PERMISSION_DENIED,
    "Permission denied.",
    "Check file permissions for the .rex/ directory.",
  ],
  [
    /Unexpected token/,
    CLI_ERROR_CODES.JSON_PARSE_FAILED,
    "Failed to parse JSON file.",
    "Check for syntax errors in the file, or re-initialize with 'n-dx init'.",
  ],

  // ── LLM-specific patterns ──────────────────────────────────────────
  [
    /null or empty response/i,
    CLI_ERROR_CODES.NULL_RESPONSE,
    "The LLM returned a null or empty response.",
    "Retry the command. If the problem persists, try a different model with --model.",
  ],
  [
    /\b429\b|rate limit|too many requests/i,
    CLI_ERROR_CODES.LLM_RATE_LIMITED,
    "Rate limit exceeded — the API is temporarily throttling requests.",
    "Wait a few minutes and try again, or use a different model with --model.",
  ],
  [
    /\b401\b|invalid.*api.*key|authentication.*(fail|error|invalid|expired)|unauthorized.*(request|access|error)/i,
    CLI_ERROR_CODES.AUTH_FAILED,
    "Authentication failed — your API key or credentials were rejected.",
    "Verify your API key with: n-dx config claude.apiKey, or check CLI login.",
  ],
  [
    /etimedout|timeout|timed?\s*out/i,
    CLI_ERROR_CODES.TIMEOUT,
    "Request timed out before the API responded.",
    "Retry with a shorter input, or check your network connection.",
  ],
  [
    /\b(529|503)\b|overloaded/i,
    CLI_ERROR_CODES.LLM_SERVER_ERROR,
    "The API is temporarily overloaded or experiencing errors.",
    "Wait a moment and retry. Consider using a different model with --model.",
  ],

  [
    /not found/i,
    CLI_ERROR_CODES.RESOURCE_NOT_FOUND,
    "",  // Use original message
    "Check the ID or path and try again.",
  ],
];

function renderCLIError(code: CLIErrorCode, message: string, suggestion?: string): string {
  const errorEntry = mapCLICodeToErrorEntry(code);
  // Use E_* key for LLM-specific codes that map to a distinct entry.
  // Fall back to the original NDX_CLI_* code when the mapping returns E_UNKNOWN —
  // preserving more specific, backward-compatible error display for non-LLM errors.
  const displayKey = errorEntry.key !== "E_UNKNOWN" ? errorEntry.key : code;
  let formatted = `Error: [${displayKey}] ${message}`;
  if (suggestion) {
    formatted += `\n${colorWarn(`Hint: ${suggestion}`)}`;
  }
  return formatted;
}

/**
 * Format an error for CLI output. Returns lines to print to stderr.
 * Stack traces and raw response bodies are suppressed unless verbose mode is active.
 */
export function formatCLIError(err: unknown): string {
  // CLIError — already user-friendly
  if (err instanceof CLIError) {
    const base = renderCLIError(err.code, err.message, err.suggestion);
    if (isVerbose() && err instanceof Error) {
      const details = formatVerboseLLMErrorDetails(err);
      return details ? `${base}\n${details}` : base;
    }
    return base;
  }

  const message = err instanceof Error ? err.message : String(err);

  // Check for known patterns
  for (const [pattern, code, friendly, suggestion] of ERROR_HINTS) {
    if (pattern.test(message)) {
      const displayMsg = friendly || message;
      const base = renderCLIError(code, displayMsg, suggestion);
      if (isVerbose() && err instanceof Error) {
        const details = formatVerboseLLMErrorDetails(err);
        return details ? `${base}\n${details}` : base;
      }
      return base;
    }
  }

  // Generic fallback — show the message, suppress stack unless verbose
  const base = renderCLIError(CLI_ERROR_CODES.GENERIC, message);
  if (isVerbose() && err instanceof Error) {
    const details = formatVerboseLLMErrorDetails(err);
    return details ? `${base}\n${details}` : base;
  }
  return base;
}

/**
 * Handle a CLI error: print it and exit.
 * Drop-in replacement for catch blocks in CLI entry points.
 * Respects custom exitCode if the error has one.
 */
export function handleCLIError(err: unknown): never {
  console.error(formatCLIError(err));
  const exitCode =
    err instanceof CLIError && "exitCode" in err
      ? (err as CLIError & { exitCode: number }).exitCode
      : 1;
  process.exit(exitCode);
}

/**
 * Check that .rex/ exists in the given directory.
 * Throws a CLIError with an init suggestion if missing.
 */
export function requireRexDir(dir: string): void {
  if (!existsSync(join(dir, REX_DIR))) {
    throw new CLIError(
      `Rex directory not found in ${dir}`,
      "Run 'n-dx init' to set up the project, or 'rex init' if using rex standalone.",
      CLI_ERROR_CODES.NOT_INITIALIZED,
    );
  }
}
