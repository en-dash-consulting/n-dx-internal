import type { GuardConfig } from "../schema/index.js";
import { validatePath, simpleGlobMatch } from "./paths.js";
import { validateCommand } from "./commands.js";

export { GuardError, validatePath, simpleGlobMatch } from "./paths.js";
export { validateCommand } from "./commands.js";

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
}
