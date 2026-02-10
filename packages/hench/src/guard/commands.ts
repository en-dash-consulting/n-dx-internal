/**
 * Command validation — allowlist-based filtering with hazard detection.
 *
 * Commands pass through three checks in order:
 *
 * 1. **Shell operator blocking** — rejects metacharacters that enable
 *    command chaining (`; && ||`), subshells (`` ` ``), or variable
 *    expansion (`$`). Since commands run via `sh -c`, these would allow
 *    arbitrary code execution.
 *
 * 2. **Executable allowlist** — only the base command name must appear in
 *    the configured `allowedCommands` list. Paths like `/usr/bin/node`
 *    are resolved to `node` before checking.
 *
 * 3. **Dangerous pattern detection** — even allowed commands are screened
 *    for hazardous argument patterns (e.g., `rm -rf /`, `sudo`, `eval`).
 *
 * @module
 */

import { GuardError } from "./paths.js";

/** Shell metacharacters that enable command chaining or subshells. */
const SHELL_OPERATORS = /[;&|`$]/;

/**
 * Patterns matching dangerous command invocations.
 * These are checked even when the base executable is in the allowlist.
 */
const DANGEROUS_PATTERNS = [
  /\brm\s+(-\w+\s+)*\//,          // rm with absolute path
  /\bsudo\b/,                      // privilege escalation
  /\bchmod\s+[0-7]*7[0-7]*\b/,    // world-writable permissions
  />\s*\/dev\//,                   // writes to device files
  /\beval\b/,                      // dynamic code execution
  /\bexec\b/,                      // process replacement
  /\bsource\b/,                    // script sourcing
  /\b\.\s+\//,                     // dot-sourcing
];

/**
 * Validate a command against the guard's security policies.
 *
 * @param command - The raw command string to validate.
 * @param allowedCommands - List of permitted executable names.
 * @throws {GuardError} if the command fails any security check.
 */
export function validateCommand(
  command: string,
  allowedCommands: string[],
): void {
  const trimmed = command.trim();

  if (!trimmed) {
    throw new GuardError("Empty command");
  }

  // Block shell operators that allow chaining or subshells.
  // Commands run via sh -c, so any of these could execute arbitrary code.
  if (SHELL_OPERATORS.test(trimmed)) {
    throw new GuardError(
      `Command contains shell operator. Commands must be simple (no ;, &, |, $, backticks): ${trimmed}`,
    );
  }

  // Extract the executable name
  const parts = trimmed.split(/\s+/);
  const executable = parts[0];

  // Handle paths like /usr/bin/node → node
  const baseName = executable.split("/").pop()!;

  if (!allowedCommands.includes(baseName)) {
    throw new GuardError(
      `Command "${baseName}" not in allowlist. Allowed: ${allowedCommands.join(", ")}`,
    );
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new GuardError(
        `Command matches dangerous pattern: ${trimmed}`,
      );
    }
  }
}
