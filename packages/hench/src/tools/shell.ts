import { execFile } from "node:child_process";
import type { GuardRails } from "../guard/index.js";

export async function toolRunCommand(
  guard: GuardRails,
  projectDir: string,
  params: { command: string; cwd?: string; timeout?: number },
): Promise<string> {
  guard.checkCommand(params.command);

  const timeout = params.timeout ?? guard.commandTimeout;
  const cwd = params.cwd
    ? guard.checkPath(params.cwd)
    : projectDir;

  return new Promise((resolve, reject) => {
    const child = execFile(
      "sh",
      ["-c", params.command],
      {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024,
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          resolve(`Command timed out after ${timeout}ms`);
          return;
        }

        const output: string[] = [];
        if (stdout) output.push(stdout);
        if (stderr) output.push(`[stderr]\n${stderr}`);
        if (error && !stdout && !stderr) {
          output.push(`Exit code: ${error.code ?? 1}`);
        }

        resolve(output.join("\n").trim() || "(no output)");
      },
    );

    // Safety: kill on timeout if execFile doesn't
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }, timeout + 1000);
  });
}
