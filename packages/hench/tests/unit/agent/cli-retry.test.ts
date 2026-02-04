import { describe, it, expect } from "vitest";
import {
  isTransientError,
  computeDelay,
  buildRetryNotice,
} from "../../../src/agent/cli-loop.js";

describe("isTransientError", () => {
  it.each([
    ["Internal Server Error 500", "500"],
    ["Bad Gateway 502", "502"],
    ["Service Unavailable 503", "503"],
    ["API overloaded 529", "529"],
    ["Rate limited 429", "429"],
    ["The API is overloaded right now", "overloaded"],
    ["connect ETIMEDOUT 1.2.3.4:443", "ETIMEDOUT"],
    ["read ECONNRESET", "ECONNRESET"],
    ["connect ECONNREFUSED 127.0.0.1:3000", "ECONNREFUSED"],
    ["socket hang up", "socket hang up"],
    ["Network error occurred", "network error"],
  ])("returns true for '%s' (%s)", (input) => {
    expect(isTransientError(input)).toBe(true);
  });

  it.each([
    ["Invalid API key", "auth error"],
    ["Permission denied", "permission error"],
    ["File not found: foo.ts", "generic failure"],
    ["SyntaxError: Unexpected token", "syntax error"],
    ["Claude CLI not found", "missing binary"],
  ])("returns false for '%s' (%s)", (input) => {
    expect(isTransientError(input)).toBe(false);
  });
});

describe("computeDelay", () => {
  it("returns baseMs for attempt 0", () => {
    expect(computeDelay(0, 2000, 30000)).toBe(2000);
  });

  it("doubles for each attempt", () => {
    expect(computeDelay(1, 2000, 30000)).toBe(4000);
    expect(computeDelay(2, 2000, 30000)).toBe(8000);
    expect(computeDelay(3, 2000, 30000)).toBe(16000);
  });

  it("caps at maxMs", () => {
    expect(computeDelay(4, 2000, 30000)).toBe(30000);
    expect(computeDelay(10, 2000, 30000)).toBe(30000);
  });
});

describe("buildRetryNotice", () => {
  it("includes attempt number", () => {
    const notice = buildRetryNotice(1, 3, 10);
    expect(notice).toContain("attempt 2/4");
  });

  it("includes prior turn count", () => {
    const notice = buildRetryNotice(0, 3, 27);
    expect(notice).toContain("27 turn(s)");
  });

  it("instructs agent to check disk state", () => {
    const notice = buildRetryNotice(0, 3, 5);
    expect(notice).toContain("Check the current state of files");
  });
});
