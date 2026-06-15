/**
 * Unit tests for Google OAuth credential detection and API-key fallback.
 *
 * Covers the three credential resolution paths in resolveGoogleAuth:
 *   1. OAuth-only  — valid OAuth credentials, no API key
 *   2. API-key-only — no client_secret / no credentials, API key set
 *   3. OAuth-expired-fallback — OAuth credentials exist but refresh fails;
 *      adapter falls back transparently to the API key
 *
 * Also covers detectGoogleAuthMethod (detection without network calls) and
 * that createGoogleApiProvider sends the correct URL/headers for each path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClaudeClientError } from "../../src/types.js";

// ── Module mocks — hoisted by vitest ─────────────────────────────────────────

vi.mock("../../src/google-oauth.js", () => ({
  resolveGoogleOAuthToken: vi.fn(),
  loadGoogleOAuthCredentials: vi.fn(),
  saveGoogleOAuthCredentials: vi.fn(),
  isAccessTokenValid: vi.fn(),
  refreshGoogleOAuthToken: vi.fn(),
  resolveGoogleCredentialsPath: vi.fn(),
  GOOGLE_AUTH_URL: "https://accounts.google.com/o/oauth2/v2/auth",
  GOOGLE_TOKEN_URL: "https://oauth2.googleapis.com/token",
  GOOGLE_OAUTH_SCOPES: [
    "https://www.googleapis.com/auth/generative-language",
    "https://www.googleapis.com/auth/cloud-platform",
  ],
}));

import {
  resolveGoogleAuth,
  detectGoogleAuthMethod,
  createGoogleApiProvider,
} from "../../src/google-api-provider.js";

import {
  resolveGoogleOAuthToken,
  loadGoogleOAuthCredentials,
} from "../../src/google-oauth.js";

const mockResolveOAuthToken = vi.mocked(resolveGoogleOAuthToken);
const mockLoadCredentials = vi.mocked(loadGoogleOAuthCredentials);

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_OAUTH_TOKEN = "ya29.test-oauth-token";
const TEST_API_KEY = "AIza-test-api-key";

function mockFetchOk(body: unknown): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function makeGeminiResponse(text = "OK"): unknown {
  return {
    candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
  };
}

// ── resolveGoogleAuth — three credential paths ────────────────────────────────

describe("resolveGoogleAuth", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
  });

  // ── Path 1: OAuth-only ──────────────────────────────────────────────────────

  it("Path 1 (OAuth-only): returns oauth method when token resolves", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    mockResolveOAuthToken.mockResolvedValue(VALID_OAUTH_TOKEN);

    const result = await resolveGoogleAuth({});

    expect(result.method).toBe("oauth");
    expect(result.token).toBe(VALID_OAUTH_TOKEN);
  });

  it("Path 1: client_secret from googleConfig.client_secret", async () => {
    mockResolveOAuthToken.mockResolvedValue(VALID_OAUTH_TOKEN);

    const result = await resolveGoogleAuth({ client_secret: "config-secret" });

    expect(result.method).toBe("oauth");
    expect(mockResolveOAuthToken).toHaveBeenCalledWith("config-secret", undefined);
  });

  it("Path 1: passes oauth_credentials_path to resolveGoogleOAuthToken", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "env-secret";
    mockResolveOAuthToken.mockResolvedValue(VALID_OAUTH_TOKEN);

    await resolveGoogleAuth({ oauth_credentials_path: "/custom/creds.json" });

    expect(mockResolveOAuthToken).toHaveBeenCalledWith("env-secret", "/custom/creds.json");
  });

  it("Path 1: OAuth wins when both OAuth and API key are available", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GEMINI_API_KEY = TEST_API_KEY;
    mockResolveOAuthToken.mockResolvedValue(VALID_OAUTH_TOKEN);

    const result = await resolveGoogleAuth({});

    expect(result.method).toBe("oauth");
    expect(result.token).toBe(VALID_OAUTH_TOKEN);
  });

  // ── Path 2: API-key-only ───────────────────────────────────────────────────

  it("Path 2 (API-key-only): returns api-key method when no client_secret", async () => {
    process.env.GEMINI_API_KEY = TEST_API_KEY;

    const result = await resolveGoogleAuth({});

    expect(result.method).toBe("api-key");
    expect(result.token).toBe(TEST_API_KEY);
    expect(mockResolveOAuthToken).not.toHaveBeenCalled();
  });

  it("Path 2: uses config api_key over env var", async () => {
    process.env.GEMINI_API_KEY = "AIza-env";

    const result = await resolveGoogleAuth({ api_key: "AIza-config" });

    expect(result.method).toBe("api-key");
    expect(result.token).toBe("AIza-config");
  });

  it("Path 2: uses custom apiKeyEnv", async () => {
    process.env.MY_CUSTOM_KEY = "AIza-custom";

    const result = await resolveGoogleAuth({}, "MY_CUSTOM_KEY");

    expect(result.method).toBe("api-key");
    expect(result.token).toBe("AIza-custom");
  });

  // ── Path 3: OAuth-expired fallback ─────────────────────────────────────────

  it("Path 3 (OAuth-expired-fallback): falls back to API key when refresh throws", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GEMINI_API_KEY = TEST_API_KEY;
    mockResolveOAuthToken.mockRejectedValue(
      new ClaudeClientError("token refresh failed", "auth", false),
    );

    const result = await resolveGoogleAuth({});

    expect(result.method).toBe("api-key");
    expect(result.token).toBe(TEST_API_KEY);
  });

  it("Path 3: falls back when resolveGoogleOAuthToken returns undefined", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GEMINI_API_KEY = TEST_API_KEY;
    mockResolveOAuthToken.mockResolvedValue(undefined);

    const result = await resolveGoogleAuth({});

    expect(result.method).toBe("api-key");
    expect(result.token).toBe(TEST_API_KEY);
  });

  // ── No auth configured ─────────────────────────────────────────────────────

  it("throws ClaudeClientError when neither OAuth nor API key resolves", async () => {
    await expect(resolveGoogleAuth({})).rejects.toThrow(ClaudeClientError);

    try {
      await resolveGoogleAuth({});
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("auth");
      expect((err as ClaudeClientError).retryable).toBe(false);
    }
  });

  it("throws when OAuth present but refresh fails and no API key", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    mockResolveOAuthToken.mockRejectedValue(new ClaudeClientError("refresh failed", "auth", false));

    await expect(resolveGoogleAuth({})).rejects.toThrow(ClaudeClientError);
  });
});

// ── detectGoogleAuthMethod ────────────────────────────────────────────────────

describe("detectGoogleAuthMethod", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("returns 'oauth' when client_secret and credentials file exist", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    mockLoadCredentials.mockResolvedValue({
      access_token: "ya29.token",
      refresh_token: "refresh",
      token_type: "Bearer",
      expiry_time: Date.now() + 3_600_000,
      client_id: "client-id.apps.googleusercontent.com",
    });

    const method = await detectGoogleAuthMethod({});
    expect(method).toBe("oauth");
  });

  it("returns 'oauth' even for expired credentials (provider will refresh)", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    mockLoadCredentials.mockResolvedValue({
      access_token: "ya29.expired",
      refresh_token: "refresh",
      token_type: "Bearer",
      expiry_time: Date.now() - 1_000, // expired
      client_id: "client-id.apps.googleusercontent.com",
    });

    const method = await detectGoogleAuthMethod({});
    expect(method).toBe("oauth");
  });

  it("returns 'api-key' when no client_secret but API key is set", async () => {
    process.env.GEMINI_API_KEY = TEST_API_KEY;
    mockLoadCredentials.mockResolvedValue(undefined);

    const method = await detectGoogleAuthMethod({});
    expect(method).toBe("api-key");
  });

  it("returns 'api-key' when client_secret present but no credentials file", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GEMINI_API_KEY = TEST_API_KEY;
    mockLoadCredentials.mockResolvedValue(undefined);

    const method = await detectGoogleAuthMethod({});
    expect(method).toBe("api-key");
  });

  it("returns undefined when nothing is configured", async () => {
    mockLoadCredentials.mockResolvedValue(undefined);

    const method = await detectGoogleAuthMethod({});
    expect(method).toBeUndefined();
  });

  it("uses client_id from googleConfig", async () => {
    mockLoadCredentials.mockResolvedValue({
      access_token: "ya29.token",
      refresh_token: "refresh",
      token_type: "Bearer",
      expiry_time: Date.now() + 3_600_000,
      client_id: "id.apps.googleusercontent.com",
    });

    const method = await detectGoogleAuthMethod({ client_secret: "config-secret" });
    expect(method).toBe("oauth");
    expect(mockLoadCredentials).toHaveBeenCalled();
  });
});

// ── createGoogleApiProvider — OAuth auth pathway ──────────────────────────────

describe("createGoogleApiProvider — OAuth authentication", () => {
  const origEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
    globalThis.fetch = originalFetch;
  });

  it("sends Authorization: Bearer header when OAuth is active", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    mockResolveOAuthToken.mockResolvedValue(VALID_OAUTH_TOKEN);
    mockFetchOk(makeGeminiResponse("Hello"));

    const provider = createGoogleApiProvider({
      googleConfig: { client_secret: "config-secret" },
    });
    await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers).toMatchObject({
      Authorization: `Bearer ${VALID_OAUTH_TOKEN}`,
    });
  });

  it("omits ?key= query param when OAuth is active", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    mockResolveOAuthToken.mockResolvedValue(VALID_OAUTH_TOKEN);
    mockFetchOk(makeGeminiResponse("Hello"));

    const provider = createGoogleApiProvider({
      googleConfig: { client_secret: "config-secret" },
    });
    await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).not.toContain("key=");
    expect(url).toContain(":generateContent");
  });

  it("sends ?key= query param (no auth header) when API key is active", async () => {
    process.env.GEMINI_API_KEY = TEST_API_KEY;
    mockFetchOk(makeGeminiResponse("Hello"));

    const provider = createGoogleApiProvider();
    await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = call[0] as string;
    expect(url).toContain(`key=${TEST_API_KEY}`);
    expect((call[1].headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("falls back to API key when OAuth refresh fails (provider.info.mode=api)", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GEMINI_API_KEY = TEST_API_KEY;
    mockResolveOAuthToken.mockRejectedValue(new ClaudeClientError("refresh failed", "auth", false));
    mockFetchOk(makeGeminiResponse("Hello"));

    const provider = createGoogleApiProvider();
    await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });

    expect(provider.info.mode).toBe("api");
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain(`key=${TEST_API_KEY}`);
  });

  it("sets info.mode to 'oauth' after successful OAuth resolution", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    mockResolveOAuthToken.mockResolvedValue(VALID_OAUTH_TOKEN);
    mockFetchOk(makeGeminiResponse("Hello"));

    const provider = createGoogleApiProvider({
      googleConfig: { client_secret: "config-secret" },
    });
    // Mode starts as "api" before first call
    expect(provider.info.mode).toBe("api");

    await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });

    // Mode updated to "oauth" after OAuth auth resolved
    expect(provider.info.mode).toBe("oauth");
  });

  it("construction succeeds with only client_secret (no API key)", () => {
    expect(() =>
      createGoogleApiProvider({
        googleConfig: { client_secret: "only-secret" },
      }),
    ).not.toThrow();
  });

  it("construction throws when neither API key nor client_secret is present", () => {
    expect(() => createGoogleApiProvider({ googleConfig: {} })).toThrow(ClaudeClientError);
    try {
      createGoogleApiProvider({ googleConfig: {} });
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("auth");
    }
  });

  it("validateAuth uses Bearer header when OAuth is active", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    mockResolveOAuthToken.mockResolvedValue(VALID_OAUTH_TOKEN);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
    });

    const provider = createGoogleApiProvider({
      googleConfig: { client_secret: "config-secret" },
    });
    const valid = await provider.validateAuth!();

    expect(valid).toBe(true);
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers).toMatchObject({
      Authorization: `Bearer ${VALID_OAUTH_TOKEN}`,
    });
    // URL should not contain ?key=
    expect(call[0]).not.toContain("key=");
    expect(call[0]).toContain("/models");
  });
});
