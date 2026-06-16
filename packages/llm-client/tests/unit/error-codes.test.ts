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
