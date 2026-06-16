/**
 * Rate-limit detection and retry utilities.
 *
 * Pure functions for parsing Retry-After headers, formatting human-readable
 * countdowns, and deciding whether an auto-retry is worthwhile.
 *
 * Used by both the API and CLI providers to surface actionable rate-limit
 * guidance instead of opaque backoff delays.
 */

import { ClaudeClientError } from "./types.js";

// ── Retry-After header parsing ──────────────────────────────────────────

/**
 * Parse an HTTP `Retry-After` header value into milliseconds.
 *
 * The header can be either:
 * - A non-negative integer (delay in **seconds**), e.g. `"47"`
 * - An HTTP-date string, e.g. `"Wed, 21 Oct 2025 07:28:00 GMT"`
 *
 * @returns Delay in milliseconds, or `undefined` if the value is missing,
 *          unparseable, or already in the past.
 */
export function parseRetryAfterHeader(
  value: string | null | undefined,
): number | undefined {
  if (value == null || value.length === 0) return undefined;

  // Try as integer seconds first (most common from LLM APIs).
  const asSeconds = Number(value);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.ceil(asSeconds) * 1000;
  }

  // Try as HTTP-date.
  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) {
    const deltaMs = asDate - Date.now();
    return deltaMs > 0 ? deltaMs : undefined;
  }

  return undefined;
}

// ── Countdown formatting ────────────────────────────────────────────────

/**
 * Format a duration in seconds into a compact human-readable countdown.
 *
 * Examples: `"47s"`, `"2m 30s"`, `"1m"`, `"0s"`.
 */
export function formatRetryCountdown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// ── Auto-retry threshold ────────────────────────────────────────────────

/** Default auto-retry threshold: retry automatically if wait ≤ 60 s. */
export const DEFAULT_AUTO_RETRY_THRESHOLD_MS = 60_000;

/**
 * Determine whether an auto-retry is worthwhile given the Retry-After delay.
 *
 * @param retryAfterMs     Parsed Retry-After delay in milliseconds.
 * @param thresholdMs      Maximum acceptable wait (default 60 000 ms).
 * @returns `true` if the wait is within the threshold.
 */
export function shouldAutoRetry(
  retryAfterMs: number,
  thresholdMs: number = DEFAULT_AUTO_RETRY_THRESHOLD_MS,
): boolean {
  return retryAfterMs > 0 && retryAfterMs <= thresholdMs;
}

// ── SDK error header extraction ─────────────────────────────────────────

/**
 * Extract a Retry-After delay from an error thrown by the Anthropic SDK.
 *
 * The SDK's `APIError` exposes `.headers` (a standard `Headers` object)
 * and `.status`. This function checks for a `retry-after` header on 429
 * responses.
 *
 * @returns Delay in milliseconds, or `undefined` if not extractable.
 */
export function extractRetryAfterMs(err: unknown): number | undefined {
  if (err == null || typeof err !== "object") return undefined;

  const typed = err as {
    status?: number;
    headers?: { get?: (name: string) => string | null };
  };

  // Only look at 429 responses.
  if (typed.status !== 429) return undefined;

  const headerVal = typed.headers?.get?.("retry-after");
  return parseRetryAfterHeader(headerVal);
}

// ── Timeout classification ──────────────────────────────────────────────

/**
 * Timeout flavors for user-facing messages.
 *
 * - `"network"` — connection-level timeout (ETIMEDOUT, ECONNRESET, socket
 *   hang up). Suggests checking connectivity.
 * - `"api"` — the request reached the server but took too long to process
 *   (HTTP 408, API-level timeout, request timeout). Suggests reducing input
 *   size or using a smaller model.
 */
export type TimeoutKind = "network" | "api";

/**
 * Classify a timeout error into network vs API processing timeout.
 *
 * Inspects the error message and, when available, the HTTP status code.
 */
export function classifyTimeout(err: Error): TimeoutKind {
  const msg = err.message.toLowerCase();

  // Network-level patterns: DNS, TCP, TLS failures and connection resets.
  if (
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("socket hang up") ||
    msg.includes("enotfound") ||
    // Anthropic SDK's APIConnectionTimeoutError message
    msg.includes("connection timed out") ||
    msg.includes("connect timeout")
  ) {
    return "network";
  }

  // Everything else is treated as an API-processing timeout:
  // HTTP 408, explicit "timeout" in the error, request exceeded deadline, etc.
  return "api";
}

// ── Token-quota refresh timestamp extraction ────────────────────────────────

/**
 * Parse a proto Duration string (e.g. `"30s"`, `"300s"`) into milliseconds.
 *
 * Google's `RetryInfo.retryDelay` uses this format. Only handles the
 * seconds-only form (`"Ns"`) produced by the Gemini API for short delays.
 *
 * @returns Milliseconds, or `undefined` for unrecognized formats.
 */
export function parseProtoDuration(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  if (!match) return undefined;
  const seconds = parseFloat(match[1]);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.ceil(seconds) * 1000;
}

/**
 * Extract a retry delay (ms) from a Google Gemini error message string.
 *
 * Gemini embeds the JSON body in the error message:
 * `"Gemini API error 429: { \"error\": { \"details\": [...] } }"`.
 * This function parses the body and returns the `retryDelay` from the first
 * `RetryInfo` detail entry.
 */
function extractGoogleRetryDelayMs(message: string): number | undefined {
  const jsonStart = message.indexOf("{");
  if (jsonStart === -1) return undefined;
  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as {
      error?: { details?: Array<Record<string, unknown>> };
    };
    for (const detail of parsed.error?.details ?? []) {
      if (typeof detail.retryDelay === "string") {
        return parseProtoDuration(detail.retryDelay);
      }
    }
  } catch {
    // Not valid JSON
  }
  return undefined;
}

/**
 * Extract a retry delay (ms) from a plain text error message.
 *
 * Covers Codex CLI stderr and any other text-based error that includes
 * patterns like `"retry after 47 seconds"` or `"try again in 30s"`.
 */
function extractTextRetryDelayMs(message: string): number | undefined {
  const pattern =
    /(?:retry(?:\s+(?:after|in))|try\s+again(?:\s+after|\s+in)|please\s+retry(?:\s+(?:after|in))?)\s+(\d+)\s*s(?:ec(?:onds?)?)?/i;
  const match = pattern.exec(message);
  if (!match) return undefined;
  const seconds = parseInt(match[1], 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

/**
 * Extract the token-quota refresh time from an LLM rate-limit error.
 *
 * Inspects the error payload across all supported providers and returns the
 * absolute time at which the quota or rate limit should reset. Returns `null`
 * when no reset time is present in the error payload.
 *
 * Provider-specific parsing:
 * - **Claude / generic** — `ClaudeClientError.retryAfterMs` (set by providers
 *   that already parsed the `Retry-After` header before throwing)
 * - **Claude (Anthropic SDK raw)** — `retry-after` HTTP header on 429 errors
 * - **Google (Gemini)** — `error.details[].retryDelay` proto Duration embedded
 *   in the JSON body of the error message
 * - **Codex (CLI text)** — plain-text retry patterns in the error message
 *   (e.g. `"Please retry after 47 seconds"`)
 *
 * Pure function — no side effects, no API calls.
 *
 * @param err    The raw error to inspect.
 * @param nowMs  Current epoch milliseconds (default: `Date.now()`). Pass a
 *               fixed value in tests for deterministic `Date` results.
 * @returns A `Date` for the refresh time, or `null` if unavailable.
 */
export function extractRefreshAt(err: unknown, nowMs = Date.now()): Date | null {
  if (err == null || typeof err !== "object") return null;

  const e = err as Record<string, unknown>;

  // 1. Pre-processed ClaudeClientError — providers store the parsed
  //    Retry-After delay here before rethrowing.
  if (
    err instanceof ClaudeClientError &&
    typeof err.retryAfterMs === "number" &&
    err.retryAfterMs > 0
  ) {
    return new Date(nowMs + err.retryAfterMs);
  }

  // 2. Anthropic SDK raw error: status 429 + retry-after header.
  if (e.status === 429) {
    const headers = e.headers as { get?: (name: string) => string | null } | undefined;
    const ms = parseRetryAfterHeader(headers?.get?.("retry-after"));
    if (ms != null) return new Date(nowMs + ms);
  }

  // 3. Google Gemini: JSON body with retryDelay in error.details[].
  // 4. Codex CLI / other text: plain-text retry patterns in message.
  if (typeof e.message === "string") {
    const ms = extractGoogleRetryDelayMs(e.message) ?? extractTextRetryDelayMs(e.message);
    if (ms != null) return new Date(nowMs + ms);
  }

  return null;
}
