/**
 * Regression tests — default error code emission across LLM error categories.
 *
 * Verifies that each major LLM error category surfaces the correct
 * bracketed error code prefix in default (non-verbose) output, with no
 * additional diagnostic lines leaking through.
 *
 * All LLM calls are mocked — no network access required.
 */

// ── Hoisted mocks (evaluated before imports) ─────────────────────────────────

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createApiClient,
  setVerbose,
  E_TIMEOUT,
  E_NULL_RESPONSE,
  E_MALFORMED_RESPONSE,
} from "@n-dx/llm-client";
import { formatCLIError } from "../../src/cli/errors.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Call complete() and return the caught error. Throws if no error is thrown. */
async function catchComplete(prompt = "ping"): Promise<unknown> {
  const client = createApiClient({
    claudeConfig: { api_key: "sk-ant-test" },
    maxRetries: 0,
  });
  try {
    await client.complete({ prompt, model: "claude-3-5-haiku-20241022" });
  } catch (err) {
    return err;
  }
  throw new Error("Expected complete() to throw but it did not");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Error code regression — default (non-verbose) output", () => {
  beforeEach(() => {
    setVerbose(false);
    mockCreate.mockReset();
  });

  afterEach(() => {
    setVerbose(false);
  });

  // ── E_TIMEOUT ──────────────────────────────────────────────────────────────

  it("E_TIMEOUT: mocked timeout produces '[E_TIMEOUT]' in default output", async () => {
    mockCreate.mockRejectedValueOnce(
      new Error("Request timed out after 300000ms"),
    );

    const err = await catchComplete();
    const output = formatCLIError(err);

    expect(output).toContain(`[${E_TIMEOUT.key}]`);
    expect(output).not.toContain("Raw response:");
    expect(output).not.toContain("Stack trace:");
  });

  // ── E_NULL_RESPONSE ────────────────────────────────────────────────────────

  it("E_NULL_RESPONSE: empty LLM body produces '[E_NULL_RESPONSE]' in default output", async () => {
    // Simulate an LLM response with no text content — the provider throws
    // ClaudeClientError("Null or empty response...", "unknown", true) when text is empty.
    mockCreate.mockResolvedValueOnce({
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-3-5-haiku-20241022",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    });

    const err = await catchComplete();
    const output = formatCLIError(err);

    expect(output).toContain(`[${E_NULL_RESPONSE.key}]`);
    expect(output).not.toContain("Raw response:");
    expect(output).not.toContain("Stack trace:");
  });

  // ── E_MALFORMED_RESPONSE ───────────────────────────────────────────────────

  it("E_MALFORMED_RESPONSE: malformed SDK JSON produces '[E_MALFORMED_RESPONSE]' in default output", async () => {
    // Simulate what happens when the SDK encounters invalid JSON in the response
    // body — a SyntaxError propagates through the provider and gets pattern-matched
    // to "malformed_output" → E_MALFORMED_RESPONSE.
    mockCreate.mockRejectedValueOnce(
      new SyntaxError("Unexpected token '<' in JSON at position 0"),
    );

    const err = await catchComplete();
    const output = formatCLIError(err);

    expect(output).toContain(`[${E_MALFORMED_RESPONSE.key}]`);
    expect(output).not.toContain("Raw response:");
    expect(output).not.toContain("Stack trace:");
  });
});
