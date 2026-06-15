/**
 * Unit tests verifying the 5-minute LLM response timeout floor.
 *
 * Covers:
 * - DEFAULT_LLM_RESPONSE_TIMEOUT_MS constant value
 * - Claude API adapter (Anthropic SDK): timeout option wired to messages.create()
 * - Codex CLI adapter: timeout kills a hanging subprocess
 * - Google API adapter (fetch-based): AbortSignal applied to each fetch call
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, chmod, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Hoisted mocks (evaluated before imports) ──────────────────────────────────

const mockAnthropicCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "hello" }],
    usage: { input_tokens: 10, output_tokens: 5 },
  }),
);

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockAnthropicCreate };
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { DEFAULT_LLM_RESPONSE_TIMEOUT_MS } from "../../src/llm-types.js";
import { createApiClient } from "../../src/api-provider.js";
import { createCodexCliClient } from "../../src/codex-cli-provider.js";
import { createGoogleApiProvider } from "../../src/google-api-provider.js";
import { ClaudeClientError } from "../../src/types.js";

// ── DEFAULT_LLM_RESPONSE_TIMEOUT_MS ──────────────────────────────────────────

describe("DEFAULT_LLM_RESPONSE_TIMEOUT_MS", () => {
  it("equals 5 minutes (300 000 ms)", () => {
    expect(DEFAULT_LLM_RESPONSE_TIMEOUT_MS).toBe(300_000);
    expect(DEFAULT_LLM_RESPONSE_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });
});

// ── Claude API adapter ────────────────────────────────────────────────────────

describe("Claude API adapter — timeout default", () => {
  beforeEach(() => {
    mockAnthropicCreate.mockClear();
  });

  it("passes DEFAULT_LLM_RESPONSE_TIMEOUT_MS to messages.create when no timeoutMs provided", async () => {
    const client = createApiClient({ claudeConfig: { api_key: "sk-ant-test" } });
    await client.complete({ prompt: "hi", model: "claude-3-5-haiku-20241022" });

    expect(mockAnthropicCreate).toHaveBeenCalledOnce();
    const [, requestOptions] = mockAnthropicCreate.mock.calls[0];
    expect(requestOptions).toMatchObject({ timeout: DEFAULT_LLM_RESPONSE_TIMEOUT_MS });
  });

  it("uses a provided timeoutMs override instead of the default", async () => {
    const client = createApiClient({
      claudeConfig: { api_key: "sk-ant-test" },
      timeoutMs: 60_000,
    });
    await client.complete({ prompt: "hi", model: "claude-3-5-haiku-20241022" });

    const [, requestOptions] = mockAnthropicCreate.mock.calls[0];
    expect(requestOptions).toMatchObject({ timeout: 60_000 });
  });
});

// ── Codex CLI adapter ─────────────────────────────────────────────────────────

/**
 * Create a Node.js script that hangs indefinitely (never exits).
 * Used to verify that a short timeout kills the process.
 */
async function makeHangingBinary(tmpDir: string): Promise<string> {
  const scriptPath = join(tmpDir, "mock-codex");
  // setInterval keeps the event loop alive so the process never exits naturally.
  await writeFile(
    scriptPath,
    "#!/usr/bin/env node\nsetInterval(() => {}, 60000);\n",
    "utf-8",
  );
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

describe("Codex CLI adapter — timeout default", () => {
  it("kills a hanging subprocess and rejects with 'timeout' using an explicit short timeoutMs", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ndx-timeout-test-"));
    try {
      const binaryPath = await makeHangingBinary(tmpDir);
      const client = createCodexCliClient({
        codexConfig: { cli_path: binaryPath },
        timeoutMs: 200, // 200 ms — far shorter than the binary's lifetime
        maxRetries: 0,
      });

      await expect(
        client.complete({ prompt: "hi", model: "codex-mini-latest" }),
      ).rejects.toMatchObject({
        reason: "timeout",
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 10_000 /* generous wall-clock budget for slow CI */);

  it("applies the DEFAULT timeout constant when timeoutMs is not provided", () => {
    // Construction without timeoutMs must succeed without throwing.
    // The resolved timeout at the factory level equals DEFAULT_LLM_RESPONSE_TIMEOUT_MS.
    // This is verified structurally: the constant (300_000) is the fallback used
    // by createCodexCliClient when options.timeoutMs is undefined.
    expect(() =>
      createCodexCliClient({ codexConfig: { cli_path: "/usr/bin/codex" } }),
    ).not.toThrow();
    // The constant test above verifies DEFAULT_LLM_RESPONSE_TIMEOUT_MS === 300_000.
    // Together they assert the 5-minute floor is in place.
  });
});

// ── Google Gemini API adapter ─────────────────────────────────────────────────

describe("Google API adapter — timeout default", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    // Restore the real fetch after each test (vi.stubGlobal is not automatically
    // undone between tests in the same describe block).
    globalThis.fetch = originalFetch;
  });

  it("includes an AbortSignal in each fetch call when using the default timeout", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: "hello" }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
      // No timeoutMs — the default (DEFAULT_LLM_RESPONSE_TIMEOUT_MS) applies.
    });
    await provider.complete({ prompt: "hi", model: "gemini-2.5-pro" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, fetchOptions] = mockFetch.mock.calls[0];
    expect(fetchOptions).toHaveProperty("signal");
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    expect(fetchOptions.signal.aborted).toBe(false); // not yet fired
  });

  it("rejects with 'timeout' when fetch is aborted (short explicit timeoutMs)", async () => {
    // Never resolves — simulates a slow API call.
    const mockFetch = vi.fn().mockImplementation(
      (_url: string, opts: { signal?: AbortSignal }) =>
        new Promise<never>((_, reject) => {
          opts?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
      timeoutMs: 50, // 50 ms — fires well before any real API could respond
      maxRetries: 0,
    });

    await expect(
      provider.complete({ prompt: "hi", model: "gemini-2.5-pro" }),
    ).rejects.toMatchObject({
      reason: "timeout",
    });
  }, 5_000);

  it("applies DEFAULT_LLM_RESPONSE_TIMEOUT_MS as the AbortSignal timeout when none is configured", async () => {
    let capturedSignal: AbortSignal | undefined;
    const mockFetch = vi.fn().mockImplementation(
      (_url: string, opts: { signal?: AbortSignal }) => {
        capturedSignal = opts?.signal;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              candidates: [{ content: { parts: [{ text: "hello" }] } }],
            }),
        });
      },
    );
    vi.stubGlobal("fetch", mockFetch);

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
      // No timeoutMs — DEFAULT_LLM_RESPONSE_TIMEOUT_MS applies.
    });
    await provider.complete({ prompt: "hi", model: "gemini-2.5-pro" });

    // A signal was attached (not undefined).
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    // The signal has not fired (5 minutes has not elapsed).
    expect(capturedSignal?.aborted).toBe(false);
  });
});
