import { describe, it, expect } from "vitest";
import { validateCommand } from "../../../src/guard/commands.js";
import { GuardError } from "../../../src/guard/paths.js";

const allowedCommands = ["npm", "npx", "node", "git", "tsc", "vitest"];

describe("validateCommand", () => {
  it("allows valid simple commands", () => {
    expect(() => validateCommand("npm test", allowedCommands)).not.toThrow();
    expect(() => validateCommand("npx tsc --noEmit", allowedCommands)).not.toThrow();
    expect(() => validateCommand("git status", allowedCommands)).not.toThrow();
    expect(() => validateCommand("tsc --build", allowedCommands)).not.toThrow();
    expect(() => validateCommand("vitest run", allowedCommands)).not.toThrow();
    expect(() => validateCommand("node script.js", allowedCommands)).not.toThrow();
  });

  it("rejects commands not in allowlist", () => {
    expect(() => validateCommand("rm -rf /tmp/test", allowedCommands)).toThrow(GuardError);
    expect(() => validateCommand("python script.py", allowedCommands)).toThrow(GuardError);
  });

  it("rejects empty commands", () => {
    expect(() => validateCommand("", allowedCommands)).toThrow(GuardError);
    expect(() => validateCommand("   ", allowedCommands)).toThrow(GuardError);
  });

  it("rejects shell chaining operators", () => {
    expect(() => validateCommand("npm test && rm -rf /", allowedCommands)).toThrow("shell operator");
    expect(() => validateCommand("npm test || echo fail", allowedCommands)).toThrow("shell operator");
    expect(() => validateCommand("npm test; rm -rf /", allowedCommands)).toThrow("shell operator");
    expect(() => validateCommand("npm test & background", allowedCommands)).toThrow("shell operator");
  });

  it("rejects shell subshells and variable expansion", () => {
    expect(() => validateCommand("node $(cat /etc/passwd)", allowedCommands)).toThrow("shell operator");
    expect(() => validateCommand("node `cat /etc/passwd`", allowedCommands)).toThrow("shell operator");
    expect(() => validateCommand("npm run $HOME", allowedCommands)).toThrow("shell operator");
  });

  it("rejects pipe operators", () => {
    expect(() => validateCommand("npm test | tee log.txt", allowedCommands)).toThrow("shell operator");
  });

  it("rejects dangerous patterns even with allowed commands", () => {
    expect(() => validateCommand("npm run sudo something", allowedCommands)).toThrow(GuardError);
  });

  it("handles commands with full paths", () => {
    expect(() =>
      validateCommand("/usr/bin/node script.js", allowedCommands),
    ).not.toThrow();
  });
});
