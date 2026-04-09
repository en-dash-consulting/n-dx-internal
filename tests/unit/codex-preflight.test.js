import { describe, expect, it } from "vitest";
import {
  buildCodexPreflightEnv,
  detectCodexHostOS,
  formatCodexPreflightFailure,
  getCodexPreflightCommand,
} from "../../packages/core/codex-preflight.js";

describe("codex preflight", () => {
  it("detects supported host OS values", () => {
    expect(detectCodexHostOS("win32")).toBe("windows");
    expect(detectCodexHostOS("darwin")).toBe("macos");
    expect(detectCodexHostOS("linux")).toBe("other");
  });

  it("builds codex exec preflight command from config", () => {
    expect(getCodexPreflightCommand({ codex: { cli_path: "/opt/codex" } })).toEqual({
      binary: "/opt/codex",
      args: ["exec", "--skip-git-repo-check", "Reply with exactly: ok"],
    });
  });

  it("injects OPENAI_API_KEY when llm.codex.api_key is configured", () => {
    const env = buildCodexPreflightEnv(
      { codex: { api_key: "sk-test-codex-key" } },
      { PATH: "/usr/bin" },
    );
    expect(env).toEqual({
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-test-codex-key",
    });
  });

  it("formats Windows auth remediation with Windows-specific guidance", () => {
    const failure = formatCodexPreflightFailure(
      {
        binary: "codex",
        detail: "not logged in",
        errorCode: undefined,
      },
      {},
      "win32",
    );

    expect(failure.code).toBe("NDX_CODEX_PREFLIGHT_AUTH_REQUIRED");
    expect(failure.lines.join("\n")).toContain("PowerShell or Command Prompt");
    expect(failure.lines.join("\n")).toContain("codex login");
    expect(failure.lines.join("\n")).toContain("llm.codex.api_key");
  });

  it("formats macOS missing-binary remediation with Terminal-specific guidance", () => {
    const failure = formatCodexPreflightFailure(
      {
        binary: "codex",
        detail: "spawn codex ENOENT",
        errorCode: "ENOENT",
      },
      {},
      "darwin",
    );

    expect(failure.code).toBe("NDX_CODEX_PREFLIGHT_NOT_INSTALLED");
    expect(failure.lines.join("\n")).toContain("On macOS");
    expect(failure.lines.join("\n")).toContain("which codex");
    expect(failure.lines.join("\n")).toContain("llm.codex.cli_path");
  });
});
