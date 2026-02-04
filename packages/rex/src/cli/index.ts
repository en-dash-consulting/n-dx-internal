#!/usr/bin/env node

import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { usage } from "./commands/constants.js";

/** Keys that accept multiple values (accumulated into arrays). */
const MULTI_VALUE_KEYS = new Set(["file"]);

function parseArgs(argv: string[]): {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string>;
  multiFlags: Record<string, string[]>;
} {
  const flags: Record<string, string> = {};
  const multiFlags: Record<string, string[]> = {};
  const positional: string[] = [];
  let command: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        const key = arg.slice(2, eq);
        const val = arg.slice(eq + 1);
        if (MULTI_VALUE_KEYS.has(key)) {
          (multiFlags[key] ??= []).push(val);
        }
        flags[key] = val;
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

  return { command, positional, flags, multiFlags };
}

async function main(): Promise<void> {
  const { command, positional, flags, multiFlags } = parseArgs(process.argv.slice(2));

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
        const VALID_LEVELS = new Set(["epic", "feature", "task", "subtask"]);
        const firstArg = positional[0];

        if (firstArg && VALID_LEVELS.has(firstArg)) {
          // Manual mode: rex add <level> --title="..."
          const dir =
            positional.length > 1 ? resolve(positional[positional.length - 1]) : process.cwd();
          const { cmdAdd } = await import("./commands/add.js");
          await cmdAdd(dir, firstArg, flags);
        } else if (firstArg || flags.description) {
          // Smart mode: rex add "natural language description" [dir]
          // Last positional may be a dir path — check if it's an existing directory
          let descParts = [...positional];
          let dir = process.cwd();
          if (descParts.length > 1) {
            const last = descParts[descParts.length - 1];
            try {
              if (existsSync(last) && statSync(last).isDirectory()) {
                dir = resolve(last);
                descParts = descParts.slice(0, -1);
              }
            } catch {
              // Not a valid path — include in description
            }
          }

          const description = descParts.length > 0
            ? descParts.join(" ")
            : flags.description;
          if (!description) {
            console.error('Usage: rex add <level> --title="..." or rex add "<description>"');
            process.exit(1);
          }
          const { cmdSmartAdd } = await import("./commands/smart-add.js");
          await cmdSmartAdd(dir, description, flags);
        } else {
          console.error('Usage: rex add <level> --title="..." or rex add "<description>"');
          process.exit(1);
        }
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
        await cmdAnalyze(resolveDir(), flags, multiFlags);
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
