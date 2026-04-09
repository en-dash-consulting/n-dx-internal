import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupHenchDir, setupRexDir, setupSourcevisionDir } from "../tests/e2e/e2e-helpers.js";

const isWin = process.platform === "win32";
const PATH_SEP = isWin ? ";" : ":";
const ROOT = join(import.meta.dirname, "..");
const CLI_PATH = join(ROOT, "packages/core/cli.js");

function parseArgs(argv) {
  const parsed = { artifactDir: join(ROOT, "codex-config-smoke-artifacts") };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifact-dir") {
      parsed.artifactDir = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

async function writeFakeBinary(filePath, {
  stdout = "",
  stderrLine = "",
  exitCode = 0,
  captureArgs = false,
  captureEnv = [],
} = {}) {
  if (isWin) {
    const cmdPath = `${filePath}.cmd`;
    const lines = ["@echo off"];
    if (captureArgs) lines.push("echo %* > \"%~f0.args\"");
    for (const envName of captureEnv) {
      lines.push(`echo %${envName}% > \"%~f0.${envName}\"`);
    }
    if (stderrLine) lines.push(`echo ${stderrLine} 1>&2`);
    if (stdout) lines.push(`echo ${stdout}`);
    if (exitCode !== 0) lines.push(`exit /b ${exitCode}`);
    await writeFile(cmdPath, lines.join("\r\n") + "\r\n");
    return cmdPath;
  }

  const lines = ["#!/bin/sh"];
  if (captureArgs) lines.push('echo "$@" > "$0.args"');
  for (const envName of captureEnv) {
    lines.push(`printf '%s' "$${envName}" > "$0.${envName}"`);
  }
  if (stderrLine) lines.push(`echo '${stderrLine}' 1>&2`);
  if (stdout) lines.push(`echo '${stdout}'`);
  if (exitCode !== 0) lines.push(`exit ${exitCode}`);
  await writeFile(filePath, lines.join("\n") + "\n");
  await chmod(filePath, 0o755);
  return filePath;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runConfig(args, opts = {}) {
  const startedAt = Date.now();
  try {
    const stdout = execFileSync("node", [CLI_PATH, "config", ...args], {
      encoding: "utf-8",
      timeout: 15000,
      stdio: "pipe",
      ...opts,
    });
    return {
      ok: true,
      stdout,
      stderr: "",
      status: 0,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      status: typeof error.status === "number" ? error.status : 1,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function setupProject(dir) {
  await setupRexDir(dir);
  await setupHenchDir(dir);
  await setupSourcevisionDir(dir);
}

async function recordCase(caseName, runCase) {
  const startedAt = Date.now();
  try {
    const details = await runCase();
    return {
      name: caseName,
      ok: true,
      durationMs: Date.now() - startedAt,
      details,
    };
  } catch (error) {
    return {
      name: caseName,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatCaseLog(result) {
  const lines = [
    `case: ${result.name}`,
    `status: ${result.ok ? "PASS" : "FAIL"}`,
    `duration_ms: ${result.durationMs}`,
  ];

  if (!result.ok) {
    lines.push(`error: ${result.error}`);
    return lines.join("\n");
  }

  const entries = result.details.logs || [];
  for (const entry of entries) {
    lines.push("");
    lines.push(`[${entry.label}] exit=${entry.status} duration_ms=${entry.durationMs}`);
    if (entry.stdout?.trim()) {
      lines.push("stdout:");
      lines.push(entry.stdout.trimEnd());
    }
    if (entry.stderr?.trim()) {
      lines.push("stderr:");
      lines.push(entry.stderr.trimEnd());
    }
  }

  if (Array.isArray(result.details.notes) && result.details.notes.length > 0) {
    lines.push("");
    lines.push("notes:");
    for (const note of result.details.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}

async function runFailureGateCase(baseDir) {
  const projectDir = join(baseDir, "failure-gate");
  const binDir = join(baseDir, "failure-bin");
  await mkdir(binDir, { recursive: true });
  await setupProject(projectDir);

  const fakeCodex = await writeFakeBinary(join(binDir, "codex-fail"), {
    stderrLine: "not logged in",
    exitCode: 7,
    captureArgs: true,
  });

  const setPath = runConfig(["llm.codex.cli_path", fakeCodex, projectDir]);
  assert(setPath.ok, "expected llm.codex.cli_path to be configurable");

  const setVendor = runConfig(["llm.vendor", "codex", projectDir]);
  assert(!setVendor.ok, "expected llm.vendor codex to fail when preflight auth is missing");
  assert(setVendor.stderr.includes("Provider auth preflight failed for \"codex\""), "expected codex preflight failure banner");
  assert(setVendor.stderr.includes("Authenticate Codex"), "expected codex auth guidance");
  assert(setVendor.stderr.includes(`${fakeCodex} login`), "expected codex login command in diagnostics");
  assert(setVendor.stderr.includes("llm.codex.api_key"), "expected api key fallback hint in diagnostics");

  try {
    await stat(join(projectDir, ".n-dx.json"));
    throw new Error("expected shared config to remain absent after failed codex selection");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  return {
    logs: [
      { label: "set-codex-cli-path", ...setPath },
      { label: "set-codex-vendor-failure", ...setVendor },
    ],
    notes: [
      "Verified preflight gate blocks Codex selection on auth failure.",
      "Verified failure leaves .n-dx.json absent for rollback safety.",
    ],
  };
}

async function runSuccessCase(baseDir) {
  const projectDir = join(baseDir, "success-project");
  const binDir = join(baseDir, "success-bin");
  await mkdir(binDir, { recursive: true });
  await setupProject(projectDir);

  const fakeCodexBase = join(binDir, "codex-success");
  const fakeCodex = await writeFakeBinary(fakeCodexBase, {
    stdout: "ok",
    captureArgs: true,
    captureEnv: ["OPENAI_API_KEY"],
  });

  const setPath = runConfig(["llm.codex.cli_path", fakeCodex, projectDir]);
  const setApiKey = runConfig(["llm.codex.api_key", "sk-test-codex-key", projectDir]);
  const setVendor = runConfig(["llm.vendor", "codex", projectDir]);

  assert(setPath.ok, "expected llm.codex.cli_path command to succeed");
  assert(setApiKey.ok, "expected llm.codex.api_key command to succeed");
  assert(setVendor.ok, "expected llm.vendor codex command to succeed");
  assert(setVendor.stdout.includes("llm.vendor = codex"), "expected codex success output");

  const argsFile = isWin ? `${fakeCodex}.args` : `${fakeCodexBase}.args`;
  const envFile = isWin ? `${fakeCodex}.OPENAI_API_KEY` : `${fakeCodexBase}.OPENAI_API_KEY`;
  const args = await readFile(argsFile, "utf-8");
  const apiKey = await readFile(envFile, "utf-8");
  const config = JSON.parse(await readFile(join(projectDir, ".n-dx.json"), "utf-8"));

  assert(args.includes("exec"), "expected codex preflight to invoke exec");
  assert(args.includes("--skip-git-repo-check"), "expected codex preflight to skip git repo check");
  assert(apiKey.trim() === "sk-test-codex-key", "expected codex preflight env to forward OPENAI_API_KEY");
  assert(config.llm?.vendor === "codex", "expected shared config to persist codex vendor");

  return {
    logs: [
      { label: "set-codex-cli-path", ...setPath },
      { label: "set-codex-api-key", ...setApiKey },
      { label: "set-codex-vendor-success", ...setVendor },
    ],
    notes: [
      "Verified Codex selection succeeds when preflight returns ok.",
      "Verified OPENAI_API_KEY is injected into the preflight process.",
    ],
  };
}

async function runRollbackCase(baseDir) {
  const projectDir = join(baseDir, "rollback-project");
  const binDir = join(baseDir, "rollback-bin");
  await mkdir(binDir, { recursive: true });
  await setupProject(projectDir);

  const codexBase = join(binDir, "codex-rollback");
  const claudeBase = join(binDir, "claude-rollback");
  const fakeCodex = await writeFakeBinary(codexBase, {
    stdout: "ok",
    captureArgs: true,
  });
  const fakeClaude = await writeFakeBinary(claudeBase, {
    stdout: '{"result":"ok"}',
    captureArgs: true,
  });

  const setCodexPath = runConfig(["llm.codex.cli_path", fakeCodex, projectDir]);
  const selectCodex = runConfig(["llm.vendor", "codex", projectDir]);
  const setClaudePath = runConfig(["llm.claude.cli_path", fakeClaude, projectDir]);
  const selectClaude = runConfig(["llm.vendor", "claude", projectDir]);

  assert(setCodexPath.ok, "expected llm.codex.cli_path to succeed before rollback");
  assert(selectCodex.ok, "expected initial codex selection to succeed before rollback");
  assert(setClaudePath.ok, "expected llm.claude.cli_path to succeed for rollback");
  assert(selectClaude.ok, "expected rollback to claude to succeed");
  assert(selectClaude.stdout.includes("llm.vendor = claude"), "expected claude rollback confirmation");

  const codexArgsFile = isWin ? `${fakeCodex}.args` : `${codexBase}.args`;
  const claudeArgsFile = isWin ? `${fakeClaude}.args` : `${claudeBase}.args`;
  const codexArgs = await readFile(codexArgsFile, "utf-8");
  const claudeArgs = await readFile(claudeArgsFile, "utf-8");
  const config = JSON.parse(await readFile(join(projectDir, ".n-dx.json"), "utf-8"));

  assert(codexArgs.includes("exec"), "expected codex preflight to run before rollback");
  assert(claudeArgs.includes("--output-format"), "expected claude preflight to run during rollback");
  assert(config.llm?.vendor === "claude", "expected rollback to persist claude as active vendor");

  return {
    logs: [
      { label: "set-codex-cli-path", ...setCodexPath },
      { label: "select-codex", ...selectCodex },
      { label: "set-claude-cli-path", ...setClaudePath },
      { label: "rollback-to-claude", ...selectClaude },
    ],
    notes: [
      "Verified rollback from Codex to Claude runs the Claude preflight path.",
      "Verified final shared config points at claude after rollback.",
    ],
  };
}

async function runSpacesInPathCase(baseDir) {
  // Explicitly use directory names that contain spaces to prove the
  // Windows shell path-quoting fix works end-to-end.
  const projectDir = join(baseDir, "spaces project");
  const binDir = join(baseDir, "spaces bin");
  await mkdir(binDir, { recursive: true });
  await setupProject(projectDir);

  // Binary name and enclosing directory both contain spaces.
  const fakeCodexBase = join(binDir, "codex binary");
  const fakeCodex = await writeFakeBinary(fakeCodexBase, {
    stdout: "ok",
    captureArgs: true,
  });

  const setPath = runConfig(["llm.codex.cli_path", fakeCodex, projectDir]);
  const setVendor = runConfig(["llm.vendor", "codex", projectDir]);

  assert(setPath.ok, `expected llm.codex.cli_path to succeed with spaces in path; stderr: ${setPath.stderr}`);
  assert(setVendor.ok, `expected llm.vendor codex to succeed with spaces in binary path; stderr: ${setVendor.stderr}`);
  assert(setVendor.stdout.includes("llm.vendor = codex"), "expected codex success output");

  const argsFile = isWin ? `${fakeCodex}.args` : `${fakeCodexBase}.args`;
  const args = await readFile(argsFile, "utf-8");

  assert(args.includes("exec"), "expected codex preflight to invoke exec with spaces-in-path binary");
  assert(args.includes("--skip-git-repo-check"), "expected codex preflight to pass --skip-git-repo-check with spaces-in-path binary");

  return {
    logs: [
      { label: "set-codex-cli-path-spaces", ...setPath },
      { label: "set-codex-vendor-spaces", ...setVendor },
    ],
    notes: [
      "Verified Codex selection succeeds when binary path and enclosing directory contain spaces.",
      `Binary path used: ${fakeCodex}`,
    ],
  };
}

async function main() {
  const { artifactDir } = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const baseDir = await mkdtemp(join(tmpdir(), "ndx-codex-config-smoke-"));

  await mkdir(artifactDir, { recursive: true });

  const results = [];
  try {
    results.push(await recordCase("preflight-gate", () => runFailureGateCase(baseDir)));
    results.push(await recordCase("codex-success", () => runSuccessCase(baseDir)));
    results.push(await recordCase("rollback-to-claude", () => runRollbackCase(baseDir)));
    results.push(await recordCase("spaces-in-path", () => runSpacesInPathCase(baseDir)));
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }

  const summary = {
    platform: process.platform,
    node: process.version,
    pathSeparator: PATH_SEP,
    totalDurationMs: Date.now() - startedAt,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };

  await writeFile(
    join(artifactDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  await writeFile(
    join(artifactDir, "preflight.log"),
    results.map((result) => formatCaseLog(result)).join("\n\n" + "=".repeat(72) + "\n\n") + "\n",
  );

  const failedCases = results.filter((result) => !result.ok);
  if (failedCases.length > 0) {
    console.error(`Codex config smoke failed on ${process.platform}. See ${join(artifactDir, "preflight.log")}`);
    for (const failedCase of failedCases) {
      console.error(`- ${failedCase.name}: ${failedCase.error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Codex config smoke passed on ${process.platform} in ${summary.totalDurationMs}ms`);
  console.log(`Artifacts: ${artifactDir}`);
}

await main();
