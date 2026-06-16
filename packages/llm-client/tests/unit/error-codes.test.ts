import { describe, it, expect } from "vitest";
import {
  E_NULL_RESPONSE,
  E_TIMEOUT,
  E_MALFORMED_RESPONSE,
  E_AUTH_FAILURE,
  E_NETWORK_ERROR,
  E_PARSE_ERROR,
  E_RATE_LIMIT,
  E_BUDGET_EXCEEDED,
  E_UNKNOWN,
  ERROR_CODE_REGISTRY,
  mapCLICodeToErrorEntry,
  mapFailureCategoryToErrorEntry,
} from "../../src/error-codes.js";
import type { ErrorCodeEntry, ErrorSeverity } from "../../src/error-codes.js";

const ALL_CODES: ErrorCodeEntry[] = [
  E_NULL_RESPONSE,
  E_TIMEOUT,
  E_MALFORMED_RESPONSE,
  E_AUTH_FAILURE,
  E_NETWORK_ERROR,
  E_PARSE_ERROR,
  E_RATE_LIMIT,
  E_BUDGET_EXCEEDED,
  E_UNKNOWN,
];

const VALID_SEVERITIES: ErrorSeverity[] = ["fatal", "error", "warn"];

describe("error code registry shape", () => {
  it.each(ALL_CODES)("$key has key, label, and severity", (entry) => {
    expect(typeof entry.key).toBe("string");
    expect(entry.key.length).toBeGreaterThan(0);
    expect(typeof entry.label).toBe("string");
    expect(entry.label.length).toBeGreaterThan(0);
    expect(VALID_SEVERITIES).toContain(entry.severity);
  });

  it("each constant's key matches its field value", () => {
    for (const entry of ALL_CODES) {
      expect(entry.key).toMatch(/^E_[A-Z_]+$/);
    }
  });

  it("all keys are unique", () => {
    const keys = ALL_CODES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("ERROR_CODE_REGISTRY", () => {
  it("contains all individual constants", () => {
    for (const entry of ALL_CODES) {
      expect(ERROR_CODE_REGISTRY[entry.key]).toBe(entry);
    }
  });

  it("has no extra entries beyond the declared constants", () => {
    expect(Object.keys(ERROR_CODE_REGISTRY).length).toBe(ALL_CODES.length);
  });
});

describe("severity classification", () => {
  it("auth failure and budget exceeded are fatal", () => {
    expect(E_AUTH_FAILURE.severity).toBe("fatal");
    expect(E_BUDGET_EXCEEDED.severity).toBe("fatal");
  });

  it("rate limit is warn (transient)", () => {
    expect(E_RATE_LIMIT.severity).toBe("warn");
  });

  it("operational failures are error severity", () => {
    for (const entry of [E_NULL_RESPONSE, E_TIMEOUT, E_MALFORMED_RESPONSE, E_NETWORK_ERROR, E_PARSE_ERROR, E_UNKNOWN]) {
      expect(entry.severity).toBe("error");
    }
  });
});

describe("mapCLICodeToErrorEntry", () => {
  it("maps timeout code to E_TIMEOUT", () => {
    expect(mapCLICodeToErrorEntry("NDX_CLI_TIMEOUT")).toBe(E_TIMEOUT);
  });

  it("maps rate-limit code to E_RATE_LIMIT", () => {
    expect(mapCLICodeToErrorEntry("NDX_CLI_LLM_RATE_LIMITED")).toBe(E_RATE_LIMIT);
  });

  it("maps auth codes to E_AUTH_FAILURE", () => {
    expect(mapCLICodeToErrorEntry("NDX_CLI_AUTH_FAILED")).toBe(E_AUTH_FAILURE);
    expect(mapCLICodeToErrorEntry("NDX_CLI_API_KEY_MISSING")).toBe(E_AUTH_FAILURE);
  });

  it("maps network error to E_NETWORK_ERROR", () => {
    expect(mapCLICodeToErrorEntry("NDX_CLI_NETWORK_ERROR")).toBe(E_NETWORK_ERROR);
  });

  it("maps NDX_CLI_JSON_PARSE_FAILED to E_UNKNOWN (config-file parsing, not LLM)", () => {
    // NDX_CLI_JSON_PARSE_FAILED is used for config/PRD file parse errors, not LLM
    // response parsing. It is intentionally excluded from the LLM E_* mapping so
    // that renderCLIError falls back to the more specific [NDX_CLI_JSON_PARSE_FAILED]
    // in output rather than collapsing to the generic [E_UNKNOWN] display.
    expect(mapCLICodeToErrorEntry("NDX_CLI_JSON_PARSE_FAILED")).toBe(E_UNKNOWN);
  });

  it("maps budget exceeded to E_BUDGET_EXCEEDED", () => {
    expect(mapCLICodeToErrorEntry("NDX_CLI_BUDGET_EXCEEDED")).toBe(E_BUDGET_EXCEEDED);
  });

  it("maps null response to E_NULL_RESPONSE", () => {
    expect(mapCLICodeToErrorEntry("NDX_CLI_NULL_RESPONSE")).toBe(E_NULL_RESPONSE);
  });

  it("maps unknown/unrecognized codes to E_UNKNOWN", () => {
    expect(mapCLICodeToErrorEntry("NDX_CLI_GENERIC")).toBe(E_UNKNOWN);
    expect(mapCLICodeToErrorEntry("NDX_CLI_NOT_INITIALIZED")).toBe(E_UNKNOWN);
    expect(mapCLICodeToErrorEntry("SOME_UNKNOWN_CODE")).toBe(E_UNKNOWN);
  });

  it("returned entry keys match E_* format", () => {
    for (const code of ["NDX_CLI_TIMEOUT", "NDX_CLI_AUTH_FAILED", "NDX_CLI_NULL_RESPONSE"]) {
      const entry = mapCLICodeToErrorEntry(code);
      expect(entry.key).toMatch(/^E_[A-Z_]+$/);
    }
  });
});

describe("mapFailureCategoryToErrorEntry", () => {
  it("maps auth category to E_AUTH_FAILURE", () => {
    expect(mapFailureCategoryToErrorEntry("auth")).toBe(E_AUTH_FAILURE);
  });

  it("maps timeout category to E_TIMEOUT", () => {
    expect(mapFailureCategoryToErrorEntry("timeout")).toBe(E_TIMEOUT);
  });

  it("maps rate_limit category to E_RATE_LIMIT", () => {
    expect(mapFailureCategoryToErrorEntry("rate_limit")).toBe(E_RATE_LIMIT);
  });

  it("maps budget_exceeded category to E_BUDGET_EXCEEDED", () => {
    expect(mapFailureCategoryToErrorEntry("budget_exceeded")).toBe(E_BUDGET_EXCEEDED);
  });

  it("maps null_response category to E_NULL_RESPONSE", () => {
    expect(mapFailureCategoryToErrorEntry("null_response")).toBe(E_NULL_RESPONSE);
  });

  it("maps malformed_output category to E_MALFORMED_RESPONSE", () => {
    expect(mapFailureCategoryToErrorEntry("malformed_output")).toBe(E_MALFORMED_RESPONSE);
  });

  it("maps unknown/unrecognized categories to E_UNKNOWN", () => {
    expect(mapFailureCategoryToErrorEntry("unknown")).toBe(E_UNKNOWN);
    expect(mapFailureCategoryToErrorEntry("not_found")).toBe(E_UNKNOWN);
    expect(mapFailureCategoryToErrorEntry("spin_detected")).toBe(E_UNKNOWN);
    expect(mapFailureCategoryToErrorEntry("transient_exhausted")).toBe(E_UNKNOWN);
    expect(mapFailureCategoryToErrorEntry("some_novel_category")).toBe(E_UNKNOWN);
  });
});
