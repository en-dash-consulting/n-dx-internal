import { execFile } from "node:child_process";

const ALLOWED_SUBCOMMANDS = [
  "status",
  "add",
  "commit",
  "diff",
  "log",
  "branch",
  "checkout",
  "stash",
  "show",
  "rev-parse",
];

export async function toolGit(
  projectDir: string,
  params: { subcommand: string; args?: string },
): Promise<string> {
  if (!ALLOWED_SUBCOMMANDS.includes(params.subcommand)) {
    throw new Error(
      `Git subcommand "${params.subcommand}" not allowed. Allowed: ${ALLOWED_SUBCOMMANDS.join(", ")}`,
    );
  }

  const args = ["git", params.subcommand];
  if (params.args) {
    // Split args respecting quotes
    args.push(...splitArgs(params.args));
  }

  return new Promise((resolve, reject) => {
    execFile(
      "sh",
      ["-c", args.join(" ")],
      {
        cwd: projectDir,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const output: string[] = [];
        if (stdout) output.push(stdout);
        if (stderr) output.push(`[stderr]\n${stderr}`);
        if (error && !stdout && !stderr) {
          output.push(`Git error: ${error.message}`);
        }
        resolve(output.join("\n").trim() || "(no output)");
      },
    );
  });
}

function splitArgs(argsStr: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const ch of argsStr) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}
