import { GuardError } from "./paths.js";

// Shell metacharacters that enable command chaining or subshells
const SHELL_OPERATORS = /[;&|`$]/;

const DANGEROUS_PATTERNS = [
  /\brm\s+(-\w+\s+)*\//,
  /\bsudo\b/,
  /\bchmod\s+[0-7]*7[0-7]*\b/,
  />\s*\/dev\//,
  /\beval\b/,
  /\bexec\b/,
  /\bsource\b/,
  /\b\.\s+\//,
];

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
