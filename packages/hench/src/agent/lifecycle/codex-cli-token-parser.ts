/**
 * Parser for extracting token usage from Codex CLI text output.
 *
 * Codex CLI outputs a token usage summary line after each run in the format:
 * "Tokens used: N in, N out" (where N may include comma separators).
 *
 * This parser scans the captured stdout/stderr buffer for this pattern and
 * extracts structured token counts compatible with the unified token metrics
 * schema.
 */

export interface CodexCliTokenUsage {
  input: number;
  output: number;
}

/**
 * Pattern to match Codex CLI token usage line.
 *
 * Matches formats like:
 * - "Tokens used: 1234 in, 567 out"
 * - "Tokens used: 1,234 in, 5,678 out"
 * - "Token used: 1234 input, 567 output"
 *
 * Captures:
 * - Group 1: input token count (may include commas)
 * - Group 2: output token count (may include commas)
 */
const TOKEN_LINE_PATTERN =
  /tokens?\s+used:\s*([\d,]+)\s*(?:in(?:put)?)\s*,\s*([\d,]+)\s*(?:out(?:put)?)/i;

/**
 * Parse a comma-formatted number string into a number.
 * Returns NaN for invalid inputs.
 */
function parseCommaNumber(value: string): number {
  const cleaned = value.replace(/,/g, "");
  // Reject negative, float, or non-numeric values
  if (!/^\d+$/.test(cleaned)) {
    return NaN;
  }
  return parseInt(cleaned, 10);
}

/**
 * Extract input and output token counts from Codex CLI output.
 *
 * Scans the output buffer for a token usage summary line and extracts
 * the counts. When multiple token lines are present (e.g., in multi-turn
 * output), uses the last occurrence.
 *
 * @param output - The captured stdout/stderr buffer from Codex CLI
 * @returns Token counts, or null if no valid token line is present
 *
 * @example
 * ```ts
 * const output = "Processing...\nTokens used: 1234 in, 567 out\nDone.";
 * const tokens = parseCodexCliTokenUsage(output);
 * // { input: 1234, output: 567 }
 * ```
 */
export function parseCodexCliTokenUsage(output: string): CodexCliTokenUsage | null {
  if (!output || !output.trim()) {
    return null;
  }

  // Find all matches (we want the last one)
  const lines = output.split(/\r?\n/);
  let lastMatch: RegExpMatchArray | null = null;

  for (const line of lines) {
    const match = line.match(TOKEN_LINE_PATTERN);
    if (match) {
      lastMatch = match;
    }
  }

  if (!lastMatch) {
    return null;
  }

  const inputStr = lastMatch[1];
  const outputStr = lastMatch[2];

  const input = parseCommaNumber(inputStr);
  const output_ = parseCommaNumber(outputStr);

  // Return null if either value is invalid
  if (!Number.isFinite(input) || !Number.isFinite(output_)) {
    return null;
  }

  return { input, output: output_ };
}
