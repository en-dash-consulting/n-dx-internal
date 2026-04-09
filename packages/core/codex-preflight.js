import { execFileSync } from "node:child_process";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * On Windows, `execFileSync` with `shell: true` delegates to cmd.exe.
 * cmd.exe tokenises the command string by whitespace, so a binary path that
 * contains spaces must be wrapped in double-quotes to be treated as a single
 * token.  On all other platforms the path is passed verbatim.
 *
 * @param {string} binary    Raw binary path or bare command name
 * @param {string} platform  Node.js `process.platform` value
 * @returns {string}         The (possibly quoted) binary for shell invocation
 */
export function quoteForShell(binary, platform = process.platform) {
  if (platform === "win32" && /\s/.test(binary)) {
    return `"${binary}"`;
  }
  return binary;
}

export function detectCodexHostOS(platform = process.platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "other";
}

export function getCodexPreflightCommand(llmConfig = {}) {
  return {
    binary: llmConfig?.codex?.cli_path || "codex",
    args: ["exec", "--skip-git-repo-check", "Reply with exactly: ok"],
  };
}

export function buildCodexPreflightEnv(llmConfig = {}, baseEnv = process.env) {
  if (isNonEmptyString(llmConfig?.codex?.api_key)) {
    return {
      ...baseEnv,
      OPENAI_API_KEY: llmConfig.codex.api_key,
    };
  }
  return baseEnv;
}

function readSpawnOutput(value) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf-8");
  return "";
}

function isCodexAuthFailure(detailLower) {
  return [
    "unauthorized",
    "invalid api key",
    "api key was rejected",
    "forbidden",
    "not logged in",
    "login required",
    "auth failed",
    "authentication failed",
    "401",
  ].some((phrase) => detailLower.includes(phrase));
}

function isCodexMissingBinary(preflight) {
  const detailLower = (preflight.detail || "").toLowerCase();
  if (preflight.errorCode === "ENOENT" || detailLower.includes("enoent")) {
    return true;
  }

  return (
    detailLower.includes("not recognized as an internal or external command") ||
    detailLower.includes("command not found") ||
    detailLower.includes("no such file or directory")
  );
}

function formatCodexPathCheck(binary, os) {
  if (os === "windows") {
    return isNonEmptyString(binary) && !binary.includes("/") && !binary.includes("\\")
      ? `Check PATH resolution in PowerShell or Command Prompt: where ${binary}`
      : `Check the configured binary path exists and is runnable: ${binary} --version`;
  }

  return isNonEmptyString(binary) && !binary.includes("/") && !binary.includes("\\")
    ? `Check PATH resolution in Terminal: which ${binary}`
    : `Check the configured binary path exists and is runnable: ${binary} --version`;
}

export function formatCodexPreflightFailure(
  preflight,
  llmConfig = {},
  platform = process.platform,
) {
  const os = detectCodexHostOS(platform);
  const detail = preflight.detail || "unknown error";
  const detailLower = detail.toLowerCase();
  const retryCommand = "ndx config llm.vendor codex";
  const loginCommand = `${preflight.binary} login`;
  const pathCheck = formatCodexPathCheck(preflight.binary, os);
  const apiKeyHint = isNonEmptyString(llmConfig?.codex?.api_key)
    ? "Update the saved key if needed: n-dx config llm.codex.api_key <key>"
    : "If you prefer API-key auth, set one first: n-dx config llm.codex.api_key <key>";

  if (isCodexMissingBinary(preflight)) {
    const lines = [
      "Codex CLI is not available from this shell, so ndx cannot verify Codex before selecting it.",
      pathCheck,
      "If Codex is installed somewhere else, set an explicit path: n-dx config llm.codex.cli_path /path/to/codex",
      `Retry after fixing the binary path: ${retryCommand}`,
    ];

    if (os === "windows") {
      lines.splice(1, 0, "After installing or moving Codex on Windows, open a new PowerShell or Command Prompt so PATH changes apply.");
    } else if (os === "macos") {
      lines.splice(1, 0, "On macOS, make sure the same Terminal environment that runs ndx can also run Codex.");
    }

    return { code: "NDX_CODEX_PREFLIGHT_NOT_INSTALLED", lines };
  }

  if (isCodexAuthFailure(detailLower)) {
    const lines = [
      os === "windows"
        ? `Authenticate Codex from PowerShell or Command Prompt: ${loginCommand}`
        : `Authenticate Codex from Terminal: ${loginCommand}`,
      apiKeyHint,
      `Retry after authenticating: ${retryCommand}`,
    ];

    if (os === "windows") {
      lines.splice(1, 0, "If your browser-based login succeeds but ndx still fails, reopen the shell so refreshed credentials are visible.");
    } else if (os === "macos") {
      lines.splice(1, 0, "If login succeeds in another shell profile, run ndx from that same Terminal session or set llm.codex.cli_path explicitly.");
    }

    return { code: "NDX_CODEX_PREFLIGHT_AUTH_REQUIRED", lines };
  }

  return {
    code: "NDX_CODEX_PREFLIGHT_INVOKE_FAILED",
    lines: [
      "Codex CLI was found, but ndx could not complete a non-destructive preflight request.",
      pathCheck,
      apiKeyHint,
      `Retry after fixing the Codex invocation: ${retryCommand}`,
    ],
  };
}

export function runCodexPreflight(llmConfig = {}, platform = process.platform) {
  const { binary, args } = getCodexPreflightCommand(llmConfig);
  const env = buildCodexPreflightEnv(llmConfig);

  // When shell:true is used on Windows, cmd.exe tokenises by whitespace.
  // Quote paths that contain spaces so the full path is treated as one token.
  const shellBinary = quoteForShell(binary, platform);

  try {
    execFileSync(shellBinary, args, {
      encoding: "utf-8",
      timeout: 15000,
      stdio: "pipe",
      shell: platform === "win32",
      env,
    });
    return { ok: true, binary, args };
  } catch (err) {
    const stderr = readSpawnOutput(err?.stderr);
    const stdout = readSpawnOutput(err?.stdout);
    const detail = (stderr || stdout || err?.message || "unknown error").trim();
    return {
      ok: false,
      binary,
      args,
      detail,
      errorCode: typeof err?.code === "string" ? err.code : undefined,
    };
  }
}
