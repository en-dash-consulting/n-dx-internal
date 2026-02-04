#!/usr/bin/env node

import { resolve } from "node:path";
import { usage } from "./commands/constants.js";
import { CLIError, handleCLIError, requireHenchDir } from "./errors.js";

function parseArgs(argv: string[]): {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string>;
} {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  let command: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        flags[arg.slice(2)] = "true";
      }
    } else if (arg === "-h") {
      flags.help = "true";
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  if (flags.help || !command) {
    usage();
    process.exit(0);
  }

  // Resolve dir: last positional arg or cwd
  const resolveDir = (): string => {
    const last = positional[positional.length - 1];
    if (last && !last.startsWith("-")) {
      return resolve(last);
    }
    return process.cwd();
  };

  try {
    // Ensure .hench/ exists for all commands except init
    if (command !== "init") {
      requireHenchDir(resolveDir());
    }

    switch (command) {
      case "init": {
        const { cmdInit } = await import("./commands/init.js");
        await cmdInit(resolveDir(), flags);
        break;
      }
      case "run": {
        const { cmdRun } = await import("./commands/run.js");
        await cmdRun(resolveDir(), flags);
        break;
      }
      case "status": {
        const { cmdStatus } = await import("./commands/status.js");
        await cmdStatus(resolveDir(), flags);
        break;
      }
      case "show": {
        const runId = positional[0];
        if (!runId) {
          throw new CLIError(
            "Missing run ID.",
            "Usage: hench show <run-id> [dir]",
          );
        }
        const dir =
          positional.length > 1 ? resolve(positional[positional.length - 1]) : process.cwd();
        const { cmdShow } = await import("./commands/show.js");
        await cmdShow(dir, runId, flags);
        break;
      }
      default:
        throw new CLIError(
          `Unknown command: ${command}`,
          "Run 'hench --help' to see available commands.",
        );
    }
  } catch (err) {
    handleCLIError(err);
  }
}

main();
