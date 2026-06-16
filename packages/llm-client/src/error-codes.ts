/**
 * Shared error code registry — typed constants for every distinct LLM and CLI
 * failure category across the n-dx monorepo.
 *
 * ## Design invariant
 *
 * This file is the **single source of truth** for error code metadata. It
 * contains no logic — only the registry shape. Classifiers, formatters, and
 * error-throwing code must import from here rather than defining ad-hoc string
 * literals.
 *
 * ## Usage
 *
 * ```ts
 * import { E_TIMEOUT, E_RATE_LIMIT } from "@n-dx/llm-client";
 *
 * if (errorCode === E_TIMEOUT.key) {
 *   console.error(`[${E_TIMEOUT.key}] ${E_TIMEOUT.label}`);
 * }
 * ```
 *
 * ## Severity levels
 *
 * - `fatal`  — operation cannot proceed without user intervention
 *              (e.g. missing auth, budget hard limit reached).
 * - `error`  — operation failed; may succeed on retry or with different input.
 * - `warn`   — transient condition; automatic retry is expected to succeed.
 */

/** Severity classification for an error code. */
export type ErrorSeverity = "fatal" | "error" | "warn";

/** Shape of a single entry in the error code registry. */
export interface ErrorCodeEntry {
  /** Stable machine-readable identifier (e.g. `'E_TIMEOUT'`). */
  key: string;
  /** Short human-readable description of the failure mode. */
  label: string;
  /** Severity level: how serious and actionable the failure is. */
  severity: ErrorSeverity;
}

/** LLM returned a null or empty response body. */
export const E_NULL_RESPONSE: ErrorCodeEntry = {
  key: "E_NULL_RESPONSE",
  label: "Null or empty response",
  severity: "error",
} as const;

/** Operation or API call exceeded the allowed time limit. */
export const E_TIMEOUT: ErrorCodeEntry = {
  key: "E_TIMEOUT",
  label: "Request timed out",
  severity: "error",
} as const;

/** Response structure is invalid or does not match the expected shape. */
export const E_MALFORMED_RESPONSE: ErrorCodeEntry = {
  key: "E_MALFORMED_RESPONSE",
  label: "Malformed response",
  severity: "error",
} as const;

/** API credentials were missing, invalid, or expired. */
export const E_AUTH_FAILURE: ErrorCodeEntry = {
  key: "E_AUTH_FAILURE",
  label: "Authentication failure",
  severity: "fatal",
} as const;

/** TCP/DNS/network-layer error prevented reaching the API. */
export const E_NETWORK_ERROR: ErrorCodeEntry = {
  key: "E_NETWORK_ERROR",
  label: "Network error",
  severity: "error",
} as const;

/** Response could not be deserialized (e.g. JSON syntax error, schema mismatch). */
export const E_PARSE_ERROR: ErrorCodeEntry = {
  key: "E_PARSE_ERROR",
  label: "Response parse error",
  severity: "error",
} as const;

/** API rate limit exceeded; retry after a back-off interval. */
export const E_RATE_LIMIT: ErrorCodeEntry = {
  key: "E_RATE_LIMIT",
  label: "Rate limit exceeded",
  severity: "warn",
} as const;

/** Configured token or cost budget was fully consumed. */
export const E_BUDGET_EXCEEDED: ErrorCodeEntry = {
  key: "E_BUDGET_EXCEEDED",
  label: "Budget exceeded",
  severity: "fatal",
} as const;

/** Failure does not match any known category. */
export const E_UNKNOWN: ErrorCodeEntry = {
  key: "E_UNKNOWN",
  label: "Unknown error",
  severity: "error",
} as const;

/**
 * Ordered map of all error codes, keyed by their machine-readable key.
 *
 * Use this for iteration (e.g. generating help text or documentation)
 * rather than exhaustive switch statements — prefer direct constant imports
 * at call sites.
 */
export const ERROR_CODE_REGISTRY: Readonly<Record<string, ErrorCodeEntry>> = {
  [E_NULL_RESPONSE.key]: E_NULL_RESPONSE,
  [E_TIMEOUT.key]: E_TIMEOUT,
  [E_MALFORMED_RESPONSE.key]: E_MALFORMED_RESPONSE,
  [E_AUTH_FAILURE.key]: E_AUTH_FAILURE,
  [E_NETWORK_ERROR.key]: E_NETWORK_ERROR,
  [E_PARSE_ERROR.key]: E_PARSE_ERROR,
  [E_RATE_LIMIT.key]: E_RATE_LIMIT,
  [E_BUDGET_EXCEEDED.key]: E_BUDGET_EXCEEDED,
  [E_UNKNOWN.key]: E_UNKNOWN,
} as const;

/**
 * Map a stable CLI error code (NDX_CLI_*) to the corresponding
 * {@link ErrorCodeEntry} from the shared registry.
 *
 * Used by CLI error formatters to emit the human-readable E_* prefix
 * (e.g. `[E_TIMEOUT]`) rather than the internal NDX_CLI_* string.
 *
 * Only LLM-specific codes are mapped to distinct E_* entries. Non-LLM
 * codes (filesystem, config, init) return {@link E_UNKNOWN} so that
 * callers can fall back to displaying the original NDX_CLI_* code and
 * preserve backward-compatible, information-rich error output.
 *
 * Note: `NDX_CLI_JSON_PARSE_FAILED` is intentionally excluded — it is
 * used for config-file parsing errors (not LLM response parsing) and
 * falls through to E_UNKNOWN so the original code is preserved in output.
 * Wire E_PARSE_ERROR to a dedicated LLM JSON-parsing scenario if needed.
 */
export function mapCLICodeToErrorEntry(code: string): ErrorCodeEntry {
  switch (code) {
    case "NDX_CLI_TIMEOUT":
      return E_TIMEOUT;
    case "NDX_CLI_LLM_RATE_LIMITED":
      return E_RATE_LIMIT;
    case "NDX_CLI_AUTH_FAILED":
    case "NDX_CLI_API_KEY_MISSING":
      return E_AUTH_FAILURE;
    case "NDX_CLI_NETWORK_ERROR":
      return E_NETWORK_ERROR;
    case "NDX_CLI_BUDGET_EXCEEDED":
      return E_BUDGET_EXCEEDED;
    case "NDX_CLI_NULL_RESPONSE":
      return E_NULL_RESPONSE;
    default:
      return E_UNKNOWN;
  }
}

/**
 * Map a {@link FailureCategory} string to the corresponding
 * {@link ErrorCodeEntry} from the shared registry.
 *
 * Accepts a plain string so the caller does not need to import the
 * `FailureCategory` type from `runtime-contract.ts` — avoiding a
 * module-graph dependency between `error-codes.ts` and `runtime-contract.ts`.
 * Unknown categories fall back to {@link E_UNKNOWN}.
 */
export function mapFailureCategoryToErrorEntry(category: string): ErrorCodeEntry {
  switch (category) {
    case "auth":
      return E_AUTH_FAILURE;
    case "timeout":
      return E_TIMEOUT;
    case "rate_limit":
      return E_RATE_LIMIT;
    case "budget_exceeded":
      return E_BUDGET_EXCEEDED;
    case "null_response":
      return E_NULL_RESPONSE;
    case "malformed_output":
      return E_MALFORMED_RESPONSE;
    case "not_found":
    case "spin_detected":
    case "completion_rejected":
    case "mcp_unavailable":
    case "transient_exhausted":
    case "unknown":
    default:
      return E_UNKNOWN;
  }
}
