import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock node:fs/promises before importing module under test
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  resolveGoogleCredentialsPath,
  loadGoogleOAuthCredentials,
  saveGoogleOAuthCredentials,
  isAccessTokenValid,
  refreshGoogleOAuthToken,
  resolveGoogleOAuthToken,
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_OAUTH_SCOPES,
} from "../../src/google-oauth.js";
import { ClaudeClientError } from "../../src/types.js";
import type { GoogleOAuthCredentials } from "../../src/google-oauth.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_CREDENTIALS: GoogleOAuthCredentials = {
  access_token: "ya29.test-access-token",
  refresh_token: "1//test-refresh-token",
  token_type: "Bearer",
  expiry_time: Date.now() + 3_600_000, // 1 hour from now
  client_id: "test-client-id.apps.googleusercontent.com",
};

const EXPIRED_CREDENTIALS: GoogleOAuthCredentials = {
  ...VALID_CREDENTIALS,
  access_token: "ya29.expired",
  expiry_time: Date.now() - 1_000, // already expired
};

// ── Constants ─────────────────────────────────────────────────────────────────

describe("exported constants", () => {
  it("GOOGLE_AUTH_URL points to Google consent screen", () => {
    expect(GOOGLE_AUTH_URL).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("GOOGLE_TOKEN_URL points to Google token endpoint", () => {
    expect(GOOGLE_TOKEN_URL).toBe("https://oauth2.googleapis.com/token");
  });

  it("GOOGLE_OAUTH_SCOPES includes generative-language and cloud-platform", () => {
    expect(GOOGLE_OAUTH_SCOPES).toContain(
      "https://www.googleapis.com/auth/generative-language",
    );
    expect(GOOGLE_OAUTH_SCOPES).toContain(
      "https://www.googleapis.com/auth/cloud-platform",
    );
  });
});

// ── resolveGoogleCredentialsPath ──────────────────────────────────────────────

describe("resolveGoogleCredentialsPath", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.GOOGLE_CREDENTIALS_PATH;
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("returns explicit path when provided", () => {
    const p = "/custom/path/creds.json";
    expect(resolveGoogleCredentialsPath(p)).toBe(p);
  });

  it("returns GOOGLE_CREDENTIALS_PATH env when set", () => {
    process.env.GOOGLE_CREDENTIALS_PATH = "/env/creds.json";
    expect(resolveGoogleCredentialsPath()).toBe("/env/creds.json");
  });

  it("prefers explicit path over env var", () => {
    process.env.GOOGLE_CREDENTIALS_PATH = "/env/creds.json";
    expect(resolveGoogleCredentialsPath("/explicit/creds.json")).toBe(
      "/explicit/creds.json",
    );
  });

  it("uses XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "/xdg";
    const p = resolveGoogleCredentialsPath();
    expect(p).toBe("/xdg/n-dx/google-credentials.json");
  });

  it("falls back to ~/.config/n-dx/google-credentials.json", () => {
    const p = resolveGoogleCredentialsPath();
    expect(p).toMatch(/\.config[\\/]n-dx[\\/]google-credentials\.json$/);
  });
});

// ── loadGoogleOAuthCredentials ────────────────────────────────────────────────

describe("loadGoogleOAuthCredentials", () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
  });

  it("returns credentials when file contains valid JSON", async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(VALID_CREDENTIALS) as never);
    const result = await loadGoogleOAuthCredentials("/test/creds.json");
    expect(result).toEqual(VALID_CREDENTIALS);
  });

  it("returns undefined when file does not exist", async () => {
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const result = await loadGoogleOAuthCredentials("/nonexistent.json");
    expect(result).toBeUndefined();
  });

  it("returns undefined when JSON is malformed", async () => {
    vi.mocked(readFile).mockResolvedValue("not-json" as never);
    const result = await loadGoogleOAuthCredentials("/bad.json");
    expect(result).toBeUndefined();
  });

  it("returns undefined when required fields are missing", async () => {
    const partial = { access_token: "tok" }; // missing required fields
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(partial) as never);
    const result = await loadGoogleOAuthCredentials("/partial.json");
    expect(result).toBeUndefined();
  });

  it("returns undefined when field types are wrong", async () => {
    const wrong = { ...VALID_CREDENTIALS, expiry_time: "not-a-number" };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(wrong) as never);
    const result = await loadGoogleOAuthCredentials("/wrong.json");
    expect(result).toBeUndefined();
  });
});

// ── saveGoogleOAuthCredentials ────────────────────────────────────────────────

describe("saveGoogleOAuthCredentials", () => {
  beforeEach(() => {
    vi.mocked(mkdir).mockResolvedValue(undefined as never);
    vi.mocked(writeFile).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.mocked(mkdir).mockReset();
    vi.mocked(writeFile).mockReset();
  });

  it("creates parent directory with recursive:true", async () => {
    await saveGoogleOAuthCredentials(VALID_CREDENTIALS, "/some/dir/creds.json");
    expect(vi.mocked(mkdir)).toHaveBeenCalledWith("/some/dir", { recursive: true });
  });

  it("writes credentials as formatted JSON with mode 0o600", async () => {
    await saveGoogleOAuthCredentials(VALID_CREDENTIALS, "/some/dir/creds.json");
    const [, content, opts] = vi.mocked(writeFile).mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed).toEqual(VALID_CREDENTIALS);
    expect(opts).toMatchObject({ mode: 0o600 });
  });
});

// ── isAccessTokenValid ────────────────────────────────────────────────────────

describe("isAccessTokenValid", () => {
  it("returns true when token expires well in the future", () => {
    const creds = { ...VALID_CREDENTIALS, expiry_time: Date.now() + 3_600_000 };
    expect(isAccessTokenValid(creds)).toBe(true);
  });

  it("returns false when token is already expired", () => {
    expect(isAccessTokenValid(EXPIRED_CREDENTIALS)).toBe(false);
  });

  it("returns false when token expires within the 60s buffer", () => {
    const creds = { ...VALID_CREDENTIALS, expiry_time: Date.now() + 30_000 };
    expect(isAccessTokenValid(creds)).toBe(false);
  });

  it("returns true just outside the 60s buffer", () => {
    const creds = { ...VALID_CREDENTIALS, expiry_time: Date.now() + 61_000 };
    expect(isAccessTokenValid(creds)).toBe(true);
  });
});

// ── refreshGoogleOAuthToken ───────────────────────────────────────────────────

describe("refreshGoogleOAuthToken", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns updated credentials on success", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "ya29.new-token",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    } as Response);

    const result = await refreshGoogleOAuthToken(EXPIRED_CREDENTIALS, "secret");
    expect(result.access_token).toBe("ya29.new-token");
    expect(result.refresh_token).toBe(EXPIRED_CREDENTIALS.refresh_token);
    expect(result.expiry_time).toBeGreaterThan(Date.now());
  });

  it("updates refresh_token when Google rotates it", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "ya29.new",
        refresh_token: "1//rotated-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    } as Response);

    const result = await refreshGoogleOAuthToken(EXPIRED_CREDENTIALS, "secret");
    expect(result.refresh_token).toBe("1//rotated-refresh");
  });

  it("sends correct parameters to token endpoint", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "tok", token_type: "Bearer", expires_in: 3600 }),
    } as Response);

    await refreshGoogleOAuthToken(EXPIRED_CREDENTIALS, "my-secret");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(init?.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe(EXPIRED_CREDENTIALS.client_id);
    expect(body.get("client_secret")).toBe("my-secret");
    expect(body.get("refresh_token")).toBe(EXPIRED_CREDENTIALS.refresh_token);
  });

  it("throws ClaudeClientError with reason 'auth' on HTTP error", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid_grant"}',
    } as Response);

    await expect(refreshGoogleOAuthToken(EXPIRED_CREDENTIALS, "bad-secret")).rejects.toThrow(
      ClaudeClientError,
    );
  });

  it("throws ClaudeClientError when response has no access_token", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token_type: "Bearer", expires_in: 3600 }),
    } as Response);

    await expect(refreshGoogleOAuthToken(EXPIRED_CREDENTIALS, "secret")).rejects.toThrow(
      ClaudeClientError,
    );
  });
});

// ── resolveGoogleOAuthToken ───────────────────────────────────────────────────

describe("resolveGoogleOAuthToken", () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
    vi.mocked(mkdir).mockResolvedValue(undefined as never);
    vi.mocked(writeFile).mockResolvedValue(undefined as never);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(mkdir).mockReset();
    vi.mocked(writeFile).mockReset();
  });

  it("returns undefined when no credential file exists", async () => {
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const token = await resolveGoogleOAuthToken("secret", "/no/creds.json");
    expect(token).toBeUndefined();
  });

  it("returns stored access token when still valid", async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(VALID_CREDENTIALS) as never);
    const token = await resolveGoogleOAuthToken("secret", "/creds.json");
    expect(token).toBe(VALID_CREDENTIALS.access_token);
    // fetch should NOT have been called (no refresh needed)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("refreshes and returns new token when expired", async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(EXPIRED_CREDENTIALS) as never);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "ya29.refreshed",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    } as unknown as Response);

    const token = await resolveGoogleOAuthToken("secret", "/creds.json");
    expect(token).toBe("ya29.refreshed");
    // New credentials should have been persisted
    expect(vi.mocked(writeFile)).toHaveBeenCalled();
  });

  it("returns undefined when refresh fails", async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(EXPIRED_CREDENTIALS) as never);
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid_grant"}',
    } as unknown as Response);

    const token = await resolveGoogleOAuthToken("secret", "/creds.json");
    expect(token).toBeUndefined();
    // Should NOT have saved anything
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });
});
