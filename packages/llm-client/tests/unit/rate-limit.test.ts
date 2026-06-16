/**
 * Unit tests for rate-limit detection and retry utilities.
 *
 * Covers: Retry-After header parsing, countdown formatting,
 * auto-retry threshold logic, SDK error extraction, timeout
 * classification, proto Duration parsing, and refresh-timestamp extraction.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseRetryAfterHeader,
  formatRetryCountdown,
  shouldAutoRetry,
  extractRetryAfterMs,
  classifyTimeout,
  DEFAULT_AUTO_RETRY_THRESHOLD_MS,
  parseProtoDuration,
  extractRefreshAt,
} from "../../src/rate-limit.js";
import { ClaudeClientError } from "../../src/types.js";

// ── parseRetryAfterHeader ───────────────────────────────────────────

describe("parseRetryAfterHeader", () => {
  it("parses integer seconds", () => {
    expect(parseRetryAfterHeader("47")).toBe(47_000);
  });

  it("parses zero seconds", () => {
    expect(parseRetryAfterHeader("0")).toBe(0);
  });

  it("rounds fractional seconds up to whole milliseconds", () => {
    // "1.5" → Number("1.5") = 1.5, ceil(1.5) = 2, * 1000 = 2000
    expect(parseRetryAfterHeader("1.5")).toBe(2000);
  });

  it("parses HTTP-date in the future", () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    const ms = parseRetryAfterHeader(future);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(31_000);
  });

  it("returns undefined for HTTP-date in the past", () => {
    const past = new Date(Date.now() - 10_000).toUTCString();
    expect(parseRetryAfterHeader(past)).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(parseRetryAfterHeader(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(parseRetryAfterHeader(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseRetryAfterHeader("")).toBeUndefined();
  });

  it("returns undefined for non-numeric, non-date string", () => {
    expect(parseRetryAfterHeader("not-a-number")).toBeUndefined();
  });

  it("returns undefined for negative seconds", () => {
    // -5 is finite and >= 0 is false → tries date parse, which gives NaN
    expect(parseRetryAfterHeader("-5")).toBeUndefined();
  });
});

// ── formatRetryCountdown ────────────────────────────────────────────

describe("formatRetryCountdown", () => {
  it("formats seconds below 60", () => {
    expect(formatRetryCountdown(47)).toBe("47s");
  });

  it("formats zero seconds", () => {
    expect(formatRetryCountdown(0)).toBe("0s");
  });

  it("formats exactly 60 seconds as 1m", () => {
    expect(formatRetryCountdown(60)).toBe("1m");
  });

  it("formats minutes and seconds", () => {
    expect(formatRetryCountdown(150)).toBe("2m 30s");
  });

  it("clamps negative values to 0s", () => {
    expect(formatRetryCountdown(-10)).toBe("0s");
  });

  it("rounds to nearest second", () => {
    expect(formatRetryCountdown(47.7)).toBe("48s");
  });

  it("formats large values", () => {
    expect(formatRetryCountdown(3600)).toBe("60m");
  });
});

// ── shouldAutoRetry ─────────────────────────────────────────────────

describe("shouldAutoRetry", () => {
  it("returns true when delay is within default threshold", () => {
    expect(shouldAutoRetry(30_000)).toBe(true);
  });

  it("returns true at the exact threshold boundary", () => {
    expect(shouldAutoRetry(DEFAULT_AUTO_RETRY_THRESHOLD_MS)).toBe(true);
  });

  it("returns false when delay exceeds threshold", () => {
    expect(shouldAutoRetry(61_000)).toBe(false);
  });

  it("returns false for zero delay", () => {
    expect(shouldAutoRetry(0)).toBe(false);
  });

  it("returns false for negative delay", () => {
    expect(shouldAutoRetry(-1000)).toBe(false);
  });

  it("respects custom threshold", () => {
    expect(shouldAutoRetry(5000, 3000)).toBe(false);
    expect(shouldAutoRetry(2000, 3000)).toBe(true);
  });
});

// ── extractRetryAfterMs ─────────────────────────────────────────────

describe("extractRetryAfterMs", () => {
  it("extracts from a 429 error with headers", () => {
    const err = {
      status: 429,
      headers: { get: (name: string) => (name === "retry-after" ? "30" : null) },
      message: "rate limited",
    };
    expect(extractRetryAfterMs(err)).toBe(30_000);
  });

  it("returns undefined for non-429 status", () => {
    const err = {
      status: 500,
      headers: { get: () => "30" },
      message: "server error",
    };
    expect(extractRetryAfterMs(err)).toBeUndefined();
  });

  it("returns undefined when headers lack retry-after", () => {
    const err = {
      status: 429,
      headers: { get: () => null },
      message: "rate limited",
    };
    expect(extractRetryAfterMs(err)).toBeUndefined();
  });

  it("returns undefined for null error", () => {
    expect(extractRetryAfterMs(null)).toBeUndefined();
  });

  it("returns undefined for non-object error", () => {
    expect(extractRetryAfterMs("string")).toBeUndefined();
  });

  it("returns undefined when no headers property", () => {
    const err = { status: 429, message: "rate limited" };
    expect(extractRetryAfterMs(err)).toBeUndefined();
  });

  it("returns undefined when headers.get is not a function", () => {
    const err = { status: 429, headers: { "retry-after": "30" }, message: "" };
    expect(extractRetryAfterMs(err)).toBeUndefined();
  });
});

// ── ClaudeClientError retryAfterMs ──────────────────────────────────

describe("ClaudeClientError retryAfterMs", () => {
  it("stores retryAfterMs when positive", () => {
    const err = new ClaudeClientError("rate limited", "rate-limit", true, 30_000);
    expect(err.retryAfterMs).toBe(30_000);
  });

  it("omits retryAfterMs when zero", () => {
    const err = new ClaudeClientError("rate limited", "rate-limit", true, 0);
    expect(err.retryAfterMs).toBeUndefined();
  });

  it("omits retryAfterMs when not provided", () => {
    const err = new ClaudeClientError("rate limited", "rate-limit", true);
    expect(err.retryAfterMs).toBeUndefined();
  });

  it("omits retryAfterMs when negative", () => {
    const err = new ClaudeClientError("rate limited", "rate-limit", true, -100);
    expect(err.retryAfterMs).toBeUndefined();
  });
});

// ── classifyTimeout ─────────────────────────────────────────────────

describe("classifyTimeout", () => {
  it("classifies ETIMEDOUT as network", () => {
    expect(classifyTimeout(new Error("connect ETIMEDOUT 1.2.3.4:443"))).toBe("network");
  });

  it("classifies ECONNRESET as network", () => {
    expect(classifyTimeout(new Error("read ECONNRESET"))).toBe("network");
  });

  it("classifies ECONNREFUSED as network", () => {
    expect(classifyTimeout(new Error("connect ECONNREFUSED 127.0.0.1:443"))).toBe("network");
  });

  it("classifies socket hang up as network", () => {
    expect(classifyTimeout(new Error("socket hang up"))).toBe("network");
  });

  it("classifies connection timed out as network", () => {
    expect(classifyTimeout(new Error("Connection timed out"))).toBe("network");
  });

  it("classifies ENOTFOUND as network", () => {
    expect(classifyTimeout(new Error("getaddrinfo ENOTFOUND api.anthropic.com"))).toBe("network");
  });

  it("classifies generic timeout as api", () => {
    expect(classifyTimeout(new Error("Request timeout after 300000ms"))).toBe("api");
  });

  it("classifies 408 timeout as api", () => {
    expect(classifyTimeout(new Error("408 Request Timeout"))).toBe("api");
  });

  it("classifies unknown error as api", () => {
    expect(classifyTimeout(new Error("something timed out"))).toBe("api");
  });
});

// ── parseProtoDuration ──────────────────────────────────────────────

describe("parseProtoDuration", () => {
  it("parses a whole-second duration", () => {
    expect(parseProtoDuration("30s")).toBe(30_000);
  });

  it("parses fractional seconds (rounds up)", () => {
    expect(parseProtoDuration("1.5s")).toBe(2_000);
  });

  it("parses zero seconds", () => {
    expect(parseProtoDuration("0s")).toBe(0);
  });

  it("parses large values", () => {
    expect(parseProtoDuration("300s")).toBe(300_000);
  });

  it("returns undefined for missing unit", () => {
    expect(parseProtoDuration("30")).toBeUndefined();
  });

  it("returns undefined for minute notation", () => {
    expect(parseProtoDuration("2m")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseProtoDuration("")).toBeUndefined();
  });

  it("returns undefined for non-numeric prefix", () => {
    expect(parseProtoDuration("xs")).toBeUndefined();
  });
});

// ── extractRefreshAt ────────────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000; // fixed epoch ms for deterministic tests

describe("extractRefreshAt", () => {
  // ── null / non-object inputs ──────────────────────────────────────
  it("returns null for null", () => {
    expect(extractRefreshAt(null, FIXED_NOW)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(extractRefreshAt(undefined, FIXED_NOW)).toBeNull();
  });

  it("returns null for a plain string", () => {
    expect(extractRefreshAt("rate limited", FIXED_NOW)).toBeNull();
  });

  it("returns null for a plain number", () => {
    expect(extractRefreshAt(429, FIXED_NOW)).toBeNull();
  });

  // ── ClaudeClientError with retryAfterMs ───────────────────────────
  it("returns Date from ClaudeClientError.retryAfterMs", () => {
    const err = new ClaudeClientError("rate limited", "rate-limit", true, 30_000);
    const result = extractRefreshAt(err, FIXED_NOW);
    expect(result).toEqual(new Date(FIXED_NOW + 30_000));
  });

  it("returns null from ClaudeClientError with no retryAfterMs", () => {
    const err = new ClaudeClientError("rate limited", "rate-limit", true);
    expect(extractRefreshAt(err, FIXED_NOW)).toBeNull();
  });

  it("returns null from ClaudeClientError with retryAfterMs=0", () => {
    // ClaudeClientError constructor drops zero retryAfterMs, so err.retryAfterMs is undefined
    const err = new ClaudeClientError("rate limited", "rate-limit", true, 0);
    expect(extractRefreshAt(err, FIXED_NOW)).toBeNull();
  });

  // ── Claude / Anthropic SDK raw error (status + headers) ──────────
  it("returns Date from Anthropic SDK 429 error with retry-after header", () => {
    const err = {
      status: 429,
      headers: { get: (name: string) => (name === "retry-after" ? "47" : null) },
      message: "Too Many Requests",
    };
    const result = extractRefreshAt(err, FIXED_NOW);
    expect(result).toEqual(new Date(FIXED_NOW + 47_000));
  });

  it("returns Date from Anthropic SDK 429 error with HTTP-date retry-after", () => {
    // parseRetryAfterHeader calls Date.now() internally for HTTP-dates, so use
    // a real future timestamp — not the fixed FIXED_NOW epoch which is in the past.
    const futureMs = Date.now() + 60_000;
    const futureDate = new Date(futureMs).toUTCString();
    const err = {
      status: 429,
      headers: { get: (name: string) => (name === "retry-after" ? futureDate : null) },
      message: "Too Many Requests",
    };
    const before = Date.now();
    const result = extractRefreshAt(err);
    expect(result).not.toBeNull();
    // The returned Date should be approximately 60 s after the call was made.
    const resultMs = (result as Date).getTime();
    expect(resultMs).toBeGreaterThan(before + 59_000);
    expect(resultMs).toBeLessThan(before + 61_000);
  });

  it("returns null from 429 error with no retry-after header", () => {
    const err = {
      status: 429,
      headers: { get: () => null },
      message: "rate limited",
    };
    expect(extractRefreshAt(err, FIXED_NOW)).toBeNull();
  });

  it("returns null from non-429 error with retry-after header", () => {
    const err = {
      status: 500,
      headers: { get: () => "30" },
      message: "server error",
    };
    expect(extractRefreshAt(err, FIXED_NOW)).toBeNull();
  });

  it("returns null from 429 error with no headers property", () => {
    const err = { status: 429, message: "rate limited" };
    expect(extractRefreshAt(err, FIXED_NOW)).toBeNull();
  });

  // ── Google (Gemini) JSON body ─────────────────────────────────────
  it("returns Date from Gemini error message with retryDelay", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        message: "Resource exhausted",
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "30s",
          },
        ],
      },
    });
    const err = { message: `Gemini API error 429: ${body}` };
    expect(extractRefreshAt(err, FIXED_NOW)).toEqual(new Date(FIXED_NOW + 30_000));
  });

  it("returns Date from Gemini error with multiple details entries (first retryDelay wins)", () => {
    const body = JSON.stringify({
      error: {
        details: [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure" },
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "60s",
          },
        ],
      },
    });
    const err = { message: `Gemini API error 429: ${body}` };
    expect(extractRefreshAt(err, FIXED_NOW)).toEqual(new Date(FIXED_NOW + 60_000));
  });

  it("returns null from Gemini error with no retryDelay in details", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        details: [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [] },
        ],
      },
    });
    const err = { message: `Gemini API error 429: ${body}` };
    expect(extractRefreshAt(err, FIXED_NOW)).toBeNull();
  });

  it("returns null from Gemini error with empty details array", () => {
    const body = JSON.stringify({ error: { code: 429, details: [] } });
    const err = { message: `Gemini API error 429: ${body}` };
    expect(extractRefreshAt(err, FIXED_NOW)).toBeNull();
  });

  it("returns null from Gemini error with no details field", () => {
    const body = JSON.stringify({ error: { code: 429, message: "quota exceeded" } });
    const err = { message: `Gemini API error 429: ${body}` };
    expect(extractRefreshAt(err, FIXED_NOW)).toBeNull();
  });

  it("returns null when the Gemini message contains malformed JSON", () => {
    const err = { message: "Gemini API error 429: { not valid json }" };
    expect(extractRefreshAt(err, FIXED_NOW)).toBeNull();
  });

  it("returns null when message contains no JSON at all", () => {
    const err = { message: "Gemini API error 429: quota exhausted" };
    expect(extractRefreshAt(err, FIXED_NOW)).toBeNull();
  });

  // ── Codex CLI text patterns ───────────────────────────────────────
  it("parses 'retry after N seconds' from Codex stderr", () => {
    const err = { message: "Rate limit exceeded. Please retry after 47 seconds." };
    expect(extractRefreshAt(err, FIXED_NOW)).toEqual(new Date(FIXED_NOW + 47_000));
  });

  it("parses 'retry in Ns' pattern", () => {
    const err = { message: "Too many requests. Retry in 60s." };
    expect(extractRefreshAt(err, FIXED_NOW)).toEqual(new Date(FIXED_NOW + 60_000));
  });

  it("parses 'try again in N seconds' pattern", () => {
    const err = { message: "quota exhausted, try again in 30 seconds" };
    expect(extractRefreshAt(err, FIXED_NOW)).toEqual(new Date(FIXED_NOW + 30_000));
  });

  it("returns null from Codex message with no retry time", () => {
    const err = {
      message:
        "Codex rate limit exceeded — all 3 attempts failed. Wait a few minutes and try again.",
    };
    expect(extractRefreshAt(err, FIXED_NOW)).toBeNull();
  });

  it("returns null from a plain auth error message", () => {
    const err = { message: "Authentication failed: invalid API key" };
    expect(extractRefreshAt(err, FIXED_NOW)).toBeNull();
  });

  // ── Default nowMs (smoke test — only checks shape) ─────────────────
  it("uses Date.now() when nowMs is omitted", () => {
    const err = new ClaudeClientError("rate limited", "rate-limit", true, 5_000);
    const before = Date.now();
    const result = extractRefreshAt(err);
    const after = Date.now();
    expect(result).not.toBeNull();
    const ms = (result as Date).getTime();
    expect(ms).toBeGreaterThanOrEqual(before + 5_000);
    expect(ms).toBeLessThanOrEqual(after + 5_000);
  });
});
