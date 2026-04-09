import { describe, expect, it } from "vitest";
import {
  buildCodexPreflightEnv,
  detectCodexHostOS,
  formatCodexPreflightFailure,
  getCodexPreflightCommand,
  quoteForShell,
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

describe("quoteForShell", () => {
  it("returns bare command unchanged on Windows", () => {
    expect(quoteForShell("codex", "win32")).toBe("codex");
  });

  it("returns path without spaces unchanged on Windows", () => {
    expect(quoteForShell("C:\\codex\\codex.cmd", "win32")).toBe(
      "C:\\codex\\codex.cmd",
    );
  });

  it("wraps path with spaces in double-quotes on Windows", () => {
    expect(quoteForShell("C:\\Program Files\\codex\\codex.cmd", "win32")).toBe(
      '"C:\\Program Files\\codex\\codex.cmd"',
    );
  });

  it("wraps path with spaces in double-quotes when binary name itself has a space on Windows", () => {
    expect(quoteForShell("my codex", "win32")).toBe('"my codex"');
  });

  it("does not quote paths with spaces on macOS", () => {
    expect(quoteForShell("/Applications/my codex/codex", "darwin")).toBe(
      "/Applications/my codex/codex",
    );
  });

  it("does not quote paths with spaces on Linux", () => {
    expect(quoteForShell("/opt/my tools/codex", "linux")).toBe(
      "/opt/my tools/codex",
    );
  });

  it("returns path unchanged when no platform is given and path has no spaces", () => {
    expect(quoteForShell("/usr/local/bin/codex")).toBe("/usr/local/bin/codex");
  });
});
