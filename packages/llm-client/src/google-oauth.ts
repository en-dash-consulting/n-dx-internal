/**
 * Google OAuth2 credential management for n-dx.
 *
 * Handles persistent storage and automatic refresh of Google OAuth2 tokens
 * used by the Google Gemini / Vertex AI provider. Works alongside the
 * API-key flow — if OAuth credentials are present and valid they take
 * precedence over the API key.
 *
 * ## Flow (first run)
 *
 * 1. CLI: `ndx auth google` calls `runGoogleOAuthBrowserFlow()` (in core).
 * 2. User authenticates in browser; auth code is captured on a localhost
 *    redirect server.
 * 3. Code is exchanged for access + refresh tokens and written to the
 *    credential file.
 *
 * ## Subsequent runs
 *
 * `resolveGoogleOAuthToken()` loads the credential file, returns the
 * access token if still valid, or transparently refreshes it.
 *
 * ## Credential file
 *
 * `~/.config/n-dx/google-credentials.json` (XDG-aware). Override with
 * `GOOGLE_CREDENTIALS_PATH` env var or `llm.google.oauth_credentials_path`.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { ClaudeClientError } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "n-dx");
const CREDENTIALS_FILENAME = "google-credentials.json";

/** Google OAuth2 authorization endpoint. */
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/** Google OAuth2 token endpoint. */
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * OAuth2 scopes for Google AI / Vertex AI.
 *
 * - `generative-language` covers Google AI Studio / Gemini REST API.
 * - `cloud-platform` covers Vertex AI.
 */
export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/generative-language",
  "https://www.googleapis.com/auth/cloud-platform",
];

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Stored Google OAuth2 credentials, persisted to the credential file.
 */
export interface GoogleOAuthCredentials {
  /** Current access token. */
  access_token: string;
  /** Refresh token for renewing the access token. */
  refresh_token: string;
  /** Token type — always "Bearer". */
  token_type: string;
  /** Millisecond UNIX timestamp when the access token expires. */
  expiry_time: number;
  /** Client ID used to obtain these credentials. Stored so refresh is self-contained. */
  client_id: string;
}

/**
 * Result of a token exchange or refresh.
 */
export interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

// ── Path resolution ───────────────────────────────────────────────────────────

/**
 * Resolve the credential file path.
 *
 * Priority:
 * 1. Explicit `credentialsPath` argument.
 * 2. `GOOGLE_CREDENTIALS_PATH` environment variable.
 * 3. `$XDG_CONFIG_HOME/n-dx/google-credentials.json`
 * 4. `~/.config/n-dx/google-credentials.json`
 */
export function resolveGoogleCredentialsPath(credentialsPath?: string): string {
  if (credentialsPath) return credentialsPath;
  if (process.env.GOOGLE_CREDENTIALS_PATH) return process.env.GOOGLE_CREDENTIALS_PATH;
  const base = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "n-dx")
    : DEFAULT_CONFIG_DIR;
  return join(base, CREDENTIALS_FILENAME);
}

// ── Credential I/O ────────────────────────────────────────────────────────────

/**
 * Load stored Google OAuth2 credentials from the credential file.
 *
 * Returns `undefined` if the file does not exist or cannot be parsed.
 * Never throws.
 */
export async function loadGoogleOAuthCredentials(
  credentialsPath?: string,
): Promise<GoogleOAuthCredentials | undefined> {
  const filePath = resolveGoogleCredentialsPath(credentialsPath);
  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (!isGoogleOAuthCredentials(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Persist Google OAuth2 credentials to the credential file.
 *
 * Creates parent directories if needed and sets file mode 0o600 so only
 * the current user can read the tokens.
 */
export async function saveGoogleOAuthCredentials(
  credentials: GoogleOAuthCredentials,
  credentialsPath?: string,
): Promise<void> {
  const filePath = resolveGoogleCredentialsPath(credentialsPath);
  await mkdir(dirname(filePath), { recursive: true });
  const content = JSON.stringify(credentials, null, 2);
  await writeFile(filePath, content + "\n", { mode: 0o600 });
}

// ── Token validity ────────────────────────────────────────────────────────────

/**
 * Check whether the stored access token is still valid.
 *
 * A 60-second buffer ensures the token is not returned when it is about to
 * expire within the next API call.
 */
export function isAccessTokenValid(credentials: GoogleOAuthCredentials): boolean {
  const BUFFER_MS = 60_000;
  return Date.now() < credentials.expiry_time - BUFFER_MS;
}

// ── Token refresh ─────────────────────────────────────────────────────────────

/**
 * Exchange a refresh token for a new access token.
 *
 * Updates `access_token` and `expiry_time` in the returned credentials.
 * The `refresh_token` is preserved (Google does not always rotate it).
 *
 * @throws {ClaudeClientError} with reason `"auth"` if the refresh request fails.
 */
export async function refreshGoogleOAuthToken(
  credentials: GoogleOAuthCredentials,
  clientSecret: string,
): Promise<GoogleOAuthCredentials> {
  const params = new URLSearchParams({
    client_id: credentials.client_id,
    client_secret: clientSecret,
    refresh_token: credentials.refresh_token,
    grant_type: "refresh_token",
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ClaudeClientError(
      `Google token refresh failed (${response.status}): ${body}\n` +
        "Run 'ndx auth google' to re-authenticate.",
      "auth",
      false,
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;

  if (!accessToken) {
    throw new ClaudeClientError(
      "Google token refresh returned no access_token. Run 'ndx auth google' to re-authenticate.",
      "auth",
      false,
    );
  }

  return {
    ...credentials,
    access_token: accessToken,
    // Preserve a rotated refresh_token if Google returns one
    refresh_token:
      typeof data.refresh_token === "string" ? data.refresh_token : credentials.refresh_token,
    expiry_time: Date.now() + expiresIn * 1_000,
  };
}

// ── Top-level token resolution ────────────────────────────────────────────────

/**
 * Resolve a valid Google OAuth access token from the credential file.
 *
 * 1. Load credentials from disk.
 * 2. Return the stored access token if it is still valid.
 * 3. Refresh using the stored refresh token, persist the result, and return.
 * 4. Return `undefined` if no credentials exist or refresh fails.
 *
 * For the first-run interactive flow, call `runGoogleOAuthBrowserFlow()` from
 * the CLI layer (`packages/core/google-auth.js`).
 *
 * @param clientSecret  OAuth2 client secret (required for token refresh).
 * @param credentialsPath  Optional override for the credential file path.
 */
export async function resolveGoogleOAuthToken(
  clientSecret: string,
  credentialsPath?: string,
): Promise<string | undefined> {
  const credentials = await loadGoogleOAuthCredentials(credentialsPath);
  if (!credentials) return undefined;

  if (isAccessTokenValid(credentials)) {
    return credentials.access_token;
  }

  // Expired — attempt a silent refresh.
  try {
    const refreshed = await refreshGoogleOAuthToken(credentials, clientSecret);
    await saveGoogleOAuthCredentials(refreshed, credentialsPath);
    return refreshed.access_token;
  } catch {
    // Refresh failed; caller should prompt for re-authentication.
    return undefined;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function isGoogleOAuthCredentials(v: unknown): v is GoogleOAuthCredentials {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.access_token === "string" &&
    typeof o.refresh_token === "string" &&
    typeof o.token_type === "string" &&
    typeof o.expiry_time === "number" &&
    typeof o.client_id === "string"
  );
}
