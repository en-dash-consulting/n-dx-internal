/**
 * Security guard system — multi-layered protection for safe autonomous operation.
 *
 * The guard provides configurable, defense-in-depth security for the hench agent.
 * When the agent executes autonomously (running commands, reading/writing files),
 * every operation passes through the guard before execution.
 *
 * ## Security layers
 *
 * 1. **Command allowlisting** (`commands.ts`)
 *    Only explicitly permitted executables can run (e.g., npm, git, node).
 *    Unknown commands are rejected before any shell invocation.
 *
 * 2. **Shell operator blocking** (`commands.ts`)
 *    Metacharacters (`;`, `&`, `|`, `` ` ``, `$`) are rejected to prevent
 *    command chaining or subshell injection.
 *
 * 3. **Dangerous pattern detection** (`commands.ts`)
 *    Known-hazardous patterns (sudo, eval, rm -rf /, chmod 777) are blocked
 *    even when the base command is allowed.
 *
 * 4. **Path validation** (`paths.ts`)
 *    - Null-byte rejection (defense against poison-null-byte attacks)
 *    - Directory escape prevention (no `..` traversal outside project)
 *    - Glob-based blocked path patterns (e.g., `.git/**`, `node_modules/**`)
 *
 * ## Configuration
 *
 * All policies are configurable via {@link GuardConfig} in `.hench/config.json`.
 * Defaults are defined in `schema/v1.ts` (`DEFAULT_HENCH_CONFIG`).
 *
 * @see {@link GuardConfig} for the configuration interface
 * @see {@link validateCommand} for command validation details
 * @see {@link validatePath} for path validation details
 */

import type { GuardConfig } from "../schema/index.js";
import { validatePath, simpleGlobMatch } from "./paths.js";
import { validateCommand } from "./commands.js";

export { GuardError, validatePath, simpleGlobMatch } from "./paths.js";
export { validateCommand } from "./commands.js";

/**
 * Facade that applies all guard policies against a project directory.
 *
 * Instantiated once per agent run with the project's guard configuration.
 * Exposes `checkPath()` and `checkCommand()` as the primary validation API,
 * plus resource limits (`commandTimeout`, `maxFileSize`) for enforcement
 * by the agent's tool execution layer.
 */
export class GuardRails {
  private projectDir: string;
  private config: GuardConfig;

  constructor(projectDir: string, config: GuardConfig) {
    this.projectDir = projectDir;
    this.config = config;
  }

  checkPath(filepath: string): string {
    return validatePath(filepath, this.projectDir, this.config.blockedPaths);
  }

  checkCommand(command: string): void {
    validateCommand(command, this.config.allowedCommands);
  }

  get commandTimeout(): number {
    return this.config.commandTimeout;
  }

  get maxFileSize(): number {
    return this.config.maxFileSize;
  }

  get spawnTimeout(): number {
    return this.config.spawnTimeout;
  }

  get maxConcurrentProcesses(): number {
    return this.config.maxConcurrentProcesses;
  }
}
