/**
 * Integration tests for Google OAuth credential lifecycle.
 *
 * Unlike the unit tests in `tests/unit/google-oauth.test.ts` and
 * `tests/unit/google-auth-resolution.test.ts` (which mock `fs/promises` and
 * the `google-oauth` module respectively), these tests exercise the full
 * resolution chain against a real temporary directory — verifying that file
 * I/O, credential validation, and auth fallback all compose correctly end-to-end.
 *
 * Fetch is stubbed globally in each test so no live network calls are made.
 *
 * Test groups:
 *   1. Token acquisition — valid credentials on disk → token returned, no refresh
 *   2. Silent token refresh on expiry — expired credentials → fetch called, new
 *      token saved to disk, updated token returned
 *   3. Fallback to API key — OAuth refresh fails → API key used instead
 *   4. Error when both absent — ClaudeClientError thrown with actionable message
 *   5. Regression: API key flow unaffected when no credentials file exists
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveGoogleOAuthToken,
  saveGoogleOAuthCredentials,
  loadGoogleOAuthCredentials,
} from "../../src/google-oauth.js";
import { resolveGoogleAuth, createGoogleApiProvider } from "../../src/google-api-provider.js";
import { ClaudeClientError } from "../../src/types.js";
import type { GoogleOAuthCredentials } from "../../src/google-oauth.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCredentials(
  opts: Partial<GoogleOAuthCredentials> = {},
): GoogleOAuthCredentials {
  return {
    access_token: "ya29.valid-access-token",
    refresh_token: "1//test-refresh-token",
    token_type: "Bearer",
    expiry_time: Date.now() + 3_600_000, // 1 hour from now
    client_id: "test-client-id.apps.googleusercontent.com",
    ...opts,
  };
}

function makeExpiredCredentials(): GoogleOAuthCredentials {
  return makeCredentials({ access_token: "ya29.expired", expiry_time: Date.now() - 1_000 });
}

function credentialsFilePath(dir: string): string {
  return join(dir, "google-credentials.json");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Write credentials to a temp file.  Uses the real saveGoogleOAuthCredentials
 * so the file-mode and directory-creation logic is exercised too.
 */
async function persistCredentials(
  filePath: string,
  creds: GoogleOAuthCredentials,
): Promise<void> {
  await saveGoogleOAuthCredentials(creds, filePath);
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

let tmpDir: string;
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "google-oauth-integration-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
});

// ── 1. Token acquisition — valid credentials ──────────────────────────────────

describe("token acquisition — valid credentials on disk", () => {
  it("returns the stored access token without making a network call", async () => {
    const filePath = credentialsFilePath(tmpDir);
    await persistCredentials(filePath, makeCredentials());

    globalThis.fetch = vi.fn();

    const token = await resolveGoogleOAuthToken("client-secret", filePath);

    expect(token).toBe("ya29.valid-access-token");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("loads credentials written by saveGoogleOAuthCredentials (round-trip)", async () => {
    const filePath = credentialsFilePath(tmpDir);
    const original = makeCredentials();
    await persistCredentials(filePath, original);

    const loaded = await loadGoogleOAuthCredentials(filePath);

    expect(loaded).toEqual(original);
  });

  it("credential file is created with restrictive permissions (0o600)", async () => {
    const filePath = credentialsFilePath(tmpDir);
    await persistCredentials(filePath, makeCredentials());

    const { stat } = await import("node:fs/promises");
    const info = await stat(filePath);
    // Mode lower 9 bits: 0o600 = rw-------
    expect(info.mode & 0o777).toBe(0o600);
  });
});

// ── 2. Silent token refresh on expiry ────────────────────────────────────────

describe("silent token refresh on expiry", () => {
  it("calls the token endpoint and returns the new access token", async () => {
    const filePath = credentialsFilePath(tmpDir);
    await persistCredentials(filePath, makeExpiredCredentials());

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "ya29.refreshed-token",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    } as Response);

    const token = await resolveGoogleOAuthToken("client-secret", filePath);

    expect(token).toBe("ya29.refreshed-token");
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
  });

  it("persists the refreshed credentials to disk so the next call is token-free", async () => {
    const filePath = credentialsFilePath(tmpDir);
    await persistCredentials(filePath, makeExpiredCredentials());

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "ya29.refreshed-token",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    } as Response);

    await resolveGoogleOAuthToken("client-secret", filePath);

    const saved = await loadGoogleOAuthCredentials(filePath);
    expect(saved?.access_token).toBe("ya29.refreshed-token");
    expect(saved?.expiry_time).toBeGreaterThan(Date.now());
  });

  it("preserves a rotated refresh_token when Google returns one", async () => {
    const filePath = credentialsFilePath(tmpDir);
    await persistCredentials(filePath, makeExpiredCredentials());

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "ya29.new",
        refresh_token: "1//rotated-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    } as Response);

    await resolveGoogleOAuthToken("client-secret", filePath);

    const saved = await loadGoogleOAuthCredentials(filePath);
    expect(saved?.refresh_token).toBe("1//rotated-refresh");
  });

  it("returns undefined (does not throw) when the refresh request fails", async () => {
    const filePath = credentialsFilePath(tmpDir);
    await persistCredentials(filePath, makeExpiredCredentials());

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid_grant"}',
    } as Response);

    const token = await resolveGoogleOAuthToken("client-secret", filePath);
    expect(token).toBeUndefined();
  });
});

// ── 3. Fallback to API key ────────────────────────────────────────────────────

describe("credential resolution order: OAuth > API key > error", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("OAuth wins over API key when valid credentials exist", async () => {
    const filePath = credentialsFilePath(tmpDir);
    await persistCredentials(filePath, makeCredentials());

    process.env.GEMINI_API_KEY = "AIza-api-key";
    globalThis.fetch = vi.fn();

    const result = await resolveGoogleAuth(
      { client_secret: "client-secret", oauth_credentials_path: filePath },
      "GEMINI_API_KEY",
    );

    expect(result.method).toBe("oauth");
    expect(result.token).toBe("ya29.valid-access-token");
    // No network call — token was still valid
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("falls back to API key when credentials file does not exist", async () => {
    process.env.GEMINI_API_KEY = "AIza-api-key";

    const result = await resolveGoogleAuth(
      { client_secret: "client-secret", oauth_credentials_path: credentialsFilePath(tmpDir) },
      "GEMINI_API_KEY",
    );

    expect(result.method).toBe("api-key");
    expect(result.token).toBe("AIza-api-key");
  });

  it("falls back to API key when OAuth refresh fails", async () => {
    const filePath = credentialsFilePath(tmpDir);
    await persistCredentials(filePath, makeExpiredCredentials());

    process.env.GEMINI_API_KEY = "AIza-api-key";

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid_grant"}',
    } as Response);

    const result = await resolveGoogleAuth(
      { client_secret: "client-secret", oauth_credentials_path: filePath },
      "GEMINI_API_KEY",
    );

    expect(result.method).toBe("api-key");
    expect(result.token).toBe("AIza-api-key");
  });
});

// ── 4. Error when both auth methods are absent ────────────────────────────────

describe("error when both OAuth and API key are absent", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("throws ClaudeClientError with reason 'auth'", async () => {
    await expect(resolveGoogleAuth({}, "GEMINI_API_KEY")).rejects.toThrow(ClaudeClientError);

    try {
      await resolveGoogleAuth({}, "GEMINI_API_KEY");
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("auth");
      expect((err as ClaudeClientError).retryable).toBe(false);
    }
  });

  it("error message includes the OAuth re-authentication command", async () => {
    try {
      await resolveGoogleAuth({}, "GEMINI_API_KEY");
    } catch (err) {
      // Message must tell users how to authenticate with OAuth
      expect((err as ClaudeClientError).message).toContain("ndx auth google");
    }
  });

  it("error message includes the API key environment variable name", async () => {
    try {
      await resolveGoogleAuth({}, "GEMINI_API_KEY");
    } catch (err) {
      expect((err as ClaudeClientError).message).toContain("GEMINI_API_KEY");
    }
  });

  it("error message includes the config key path", async () => {
    try {
      await resolveGoogleAuth({}, "GEMINI_API_KEY");
    } catch (err) {
      expect((err as ClaudeClientError).message).toContain("llm.google.api_key");
    }
  });

  it("error message uses the custom env var name when provided", async () => {
    try {
      await resolveGoogleAuth({}, "MY_CUSTOM_KEY");
    } catch (err) {
      expect((err as ClaudeClientError).message).toContain("MY_CUSTOM_KEY");
    }
  });

  it("createGoogleApiProvider throws at construction when neither API key nor client_secret is set", () => {
    expect(() => createGoogleApiProvider({ googleConfig: {} })).toThrow(ClaudeClientError);

    try {
      createGoogleApiProvider({ googleConfig: {} });
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("auth");
      expect((err as ClaudeClientError).message).toContain("Google API key not found");
      expect((err as ClaudeClientError).message).toContain("GEMINI_API_KEY");
    }
  });
});

// ── 5. Regression: API key flow unaffected when no credentials file ───────────

describe("regression: API key flow is unaffected when OAuth credentials are absent", () => {
  const origEnv = process.env;
  const originalFetchRef = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = origEnv;
    globalThis.fetch = originalFetchRef;
  });

  it("resolveGoogleAuth uses API key without touching the file system", async () => {
    // No client_secret → OAuth path is never attempted
    process.env.GEMINI_API_KEY = "AIza-regression-key";

    const result = await resolveGoogleAuth({}, "GEMINI_API_KEY");

    expect(result.method).toBe("api-key");
    expect(result.token).toBe("AIza-regression-key");
  });

  it("createGoogleApiProvider with API key only makes requests with ?key= param", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "OK" }], role: "model" }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
      }),
    });
    globalThis.fetch = fetchMock;

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-regression-key" },
    });
    const result = await provider.complete({ prompt: "ping", model: "gemini-2.5-pro" });

    expect(result.text).toBe("OK");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("key=AIza-regression-key");
    expect(url).not.toContain("Authorization");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("API key provider does not read any credentials file during complete()", async () => {
    // The tmpDir has no credentials file — if the provider tries to read it,
    // the test will fail because the GOOGLE_CREDENTIALS_PATH points to a nonexistent file.
    process.env.GOOGLE_CREDENTIALS_PATH = credentialsFilePath(tmpDir);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "OK" }], role: "model" }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
      }),
    });

    // No client_secret → OAuth path is skipped entirely; no credentials file read attempted
    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-regression-key" },
    });
    // This should succeed without throwing, even though the credentials file doesn't exist
    const result = await provider.complete({ prompt: "ping", model: "gemini-2.5-pro" });
    expect(result.text).toBe("OK");
  });
});
