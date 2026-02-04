#!/usr/bin/env node

/**
 * Sourcevision CLI
 *
 * Commands:
 *   init             - Initialize .sourcevision/ in current project
 *   analyze [dir]    - Run analysis pipeline
 *   serve [dir]      - Start local viewer server
 *   validate [dir]   - Validate .sourcevision/ output files
 *   mcp [dir]        - Start MCP server for AI tool integration
 */

import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { usage, SV_DIR } from "./commands/constants.js";
import { cmdInit } from "./commands/init.js";
import { cmdReset } from "./commands/reset.js";
import { cmdAnalyze } from "./commands/analyze.js";
import { cmdValidate } from "./commands/validate.js";

const args = process.argv.slice(2);
const command = args[0];

// ── arg parsing & dispatch ──────────────────────────────────────────────────

let port = 3117;
const passthrough: string[] = [];

for (const a of args.slice(1)) {
  if (a.startsWith("--port=")) {
    port = parseInt(a.split("=")[1], 10);
  } else if (a.startsWith("--phase=") || a.startsWith("--only=") || a === "--fast" || a === "--full") {
    passthrough.push(a);
  }
}

// First non-flag arg after command is the target dir
const targetArg = args.slice(1).find((a) => !a.startsWith("-"));

async function cmdServe(dir: string, port: number): Promise<void> {
  const absDir = resolve(dir);
  const svDir = join(absDir, SV_DIR);

  if (!existsSync(svDir)) {
    console.error(`No .sourcevision/ directory found in: ${absDir}`);
    console.error("Run 'sourcevision init' or 'sourcevision analyze' first.");
    process.exit(1);
  }

  const { startServer } = await import("./serve.js");
  startServer(absDir, port);
}

async function cmdMcp(dir: string): Promise<void> {
  const absDir = resolve(dir);
  const svDir = join(absDir, SV_DIR);

  if (!existsSync(svDir)) {
    console.error(`No .sourcevision/ directory found in: ${absDir}`);
    console.error("Run 'sourcevision analyze' first.");
    process.exit(1);
  }

  const { startMcpServer } = await import("./mcp.js");
  await startMcpServer(absDir);
}

switch (command) {
  case "init":
    cmdInit(targetArg || ".");
    break;
  case "analyze":
    cmdAnalyze(targetArg || ".", passthrough);
    break;
  case "serve":
    cmdServe(targetArg || ".", port);
    break;
  case "validate":
    cmdValidate(targetArg || ".");
    break;
  case "reset":
    cmdReset(targetArg || ".");
    break;
  case "mcp":
    cmdMcp(targetArg || ".");
    break;
  case "--help":
  case "-h":
  case undefined:
    usage();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
}
