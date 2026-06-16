/**
 * Importability test: error code registry from @n-dx/llm-client within hench.
 *
 * Verifies that:
 * 1. All error code constants are reachable from the hench package context
 *    without introducing circular dependencies.
 * 2. Each constant satisfies the ErrorCodeEntry shape contract.
 *
 * The canonical shape/uniqueness assertions live in
 * `packages/llm-client/tests/unit/error-codes.test.ts`.
 * This file focuses on the cross-package import boundary only.
 */

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
  type ErrorCodeEntry,
} from "@n-dx/llm-client";

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

describe("error code registry — importable from hench", () => {
  it("all constants are defined (not undefined)", () => {
    for (const entry of ALL_CODES) {
      expect(entry).toBeDefined();
    }
  });

  it.each(ALL_CODES)("$key satisfies ErrorCodeEntry shape", (entry) => {
    expect(typeof entry.key).toBe("string");
    expect(entry.key.length).toBeGreaterThan(0);
    expect(typeof entry.label).toBe("string");
    expect(entry.label.length).toBeGreaterThan(0);
    expect(["fatal", "error", "warn"]).toContain(entry.severity);
  });

  it("all keys are unique", () => {
    const keys = ALL_CODES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ERROR_CODE_REGISTRY contains every constant", () => {
    for (const entry of ALL_CODES) {
      expect(ERROR_CODE_REGISTRY[entry.key]).toBe(entry);
    }
  });
});
