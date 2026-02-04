#!/usr/bin/env node

import { resolve } from "node:path";
import { usage } from "./commands/constants.js";

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
    switch (command) {
      case "init": {
        const { cmdInit } = await import("./commands/init.js");
        await cmdInit(resolveDir(), flags);
        break;
      }
      case "status": {
        const { cmdStatus } = await import("./commands/status.js");
        await cmdStatus(resolveDir(), flags);
        break;
      }
      case "next": {
        const { cmdNext } = await import("./commands/next.js");
        await cmdNext(resolveDir(), flags);
        break;
      }
      case "add": {
        const level = positional[0];
        if (!level) {
          console.error("Usage: rex add <level> [dir] --title=\"...\"");
          process.exit(1);
        }
        const dir =
          positional.length > 1 ? resolve(positional[positional.length - 1]) : process.cwd();
        const { cmdAdd } = await import("./commands/add.js");
        await cmdAdd(dir, level, flags);
        break;
      }
      case "update": {
        const id = positional[0];
        if (!id) {
          console.error("Usage: rex update <id> [dir] --status=<s>");
          process.exit(1);
        }
        const dir =
          positional.length > 1 ? resolve(positional[positional.length - 1]) : process.cwd();
        const { cmdUpdate } = await import("./commands/update.js");
        await cmdUpdate(dir, id, flags);
        break;
      }
      case "validate": {
        const { cmdValidate } = await import("./commands/validate.js");
        await cmdValidate(resolveDir(), flags);
        break;
      }
      case "recommend": {
        const { cmdRecommend } = await import("./commands/recommend.js");
        await cmdRecommend(resolveDir(), flags);
        break;
      }
      case "analyze": {
        const { cmdAnalyze } = await import("./commands/analyze.js");
        await cmdAnalyze(resolveDir(), flags);
        break;
      }
      case "mcp": {
        const { startMcpServer } = await import("./mcp.js");
        await startMcpServer(resolveDir());
        break;
      }
      default:
        console.error(`Unknown command: ${command}`);
        usage();
        process.exit(1);
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

main();
