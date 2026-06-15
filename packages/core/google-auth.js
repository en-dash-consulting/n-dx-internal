/**
 * Google OAuth2 browser-launch flow for `ndx auth google`.
 *
 * Orchestration-tier helper — imported by cli.js.  Uses only Node.js built-ins
 * plus a dynamic import of @n-dx/llm-client for credential persistence.
 *
 * ## Flow
 *
 * 1. Resolve client_id / client_secret from config or env.
 * 2. Generate PKCE code_verifier / code_challenge.
 * 3. Start a one-shot local HTTP redirect server on a random ephemeral port.
 * 4. Open the system browser to the Google consent screen.
 * 5. Wait (up to TIMEOUT_MS) for the callback with ?code= and matching ?state=.
 * 6. Exchange the auth code for access + refresh tokens.
 * 7. Persist tokens to the credential file (mode 0600).
 *
 * ## Color convention
 *
 * All user-action prompts, wait messages, and remediation hints are yellow.
 * Success messages are green.  Errors are red (via console.error, no color).
 *
 * @module n-dx/core/google-auth
 */

import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";

// ── ANSI helpers (duplicated from cli.js — no shared import allowed) ──────────

/** Detect whether ANSI color output is supported in the current terminal. */
function supportsColor() {
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") return true;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  return Boolean(process.stdout?.isTTY);
}

function ansi(code, text, reset) {
  return supportsColor() ? `\x1b[${code}m${text}\x1b[${reset}m` : text;
}

/** Yellow — user-action prompts, wait messages, remediation hints. */
function yellow(text) { return ansi("33", text, "39"); }
/** Green — success messages. */
function green(text) { return ansi("32", text, "39"); }

// ── Constants ─────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/generative-language",
  "https://www.googleapis.com/auth/cloud-platform",
];
const REDIRECT_HOST = "localhost";
const REDIRECT_PATH = "/oauth2callback";
const TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "n-dx");
const CREDENTIALS_FILENAME = "google-credentials.json";

// ── Credential file path ──────────────────────────────────────────────────────

/**
 * Resolve the Google credential file path.
 *
 * Priority: explicit arg → GOOGLE_CREDENTIALS_PATH env → XDG / default.
 *
 * @param {string|undefined} credentialsPath
 * @returns {string}
 */
function resolveCredentialsPath(credentialsPath) {
  if (credentialsPath) return credentialsPath;
  if (process.env.GOOGLE_CREDENTIALS_PATH) return process.env.GOOGLE_CREDENTIALS_PATH;
  const base = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "n-dx")
    : DEFAULT_CONFIG_DIR;
  return join(base, CREDENTIALS_FILENAME);
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

/**
 * Generate a URL-safe random PKCE code_verifier (43–128 characters).
 *
 * @returns {string}
 */
function generateCodeVerifier() {
  return randomBytes(48).toString("base64url");
}

/**
 * Derive the code_challenge from a code_verifier using SHA-256 (S256).
 *
 * @param {string} verifier
 * @returns {string}
 */
function deriveCodeChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Generate a random opaque state string to prevent CSRF.
 *
 * @returns {string}
 */
function generateState() {
  return randomBytes(24).toString("base64url");
}

// ── Browser open ──────────────────────────────────────────────────────────────

/**
 * Open `url` in the system default browser.
 *
 * Supports macOS (`open`), Linux (`xdg-open`), and Windows (`cmd /c start`).
 * Errors are silently swallowed — the caller prints the URL for manual use.
 *
 * @param {string} url
 */
function openBrowser(url) {
  const platform = process.platform;
  const [cmd, ...args] =
    platform === "darwin"
      ? ["open", url]
      : platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  execFile(cmd, [...args], (err) => {
    if (err) {
      // Silently ignore — the URL is already printed to stdout in yellow
    }
  });
}

// ── Local redirect server ─────────────────────────────────────────────────────

/**
 * Start a one-shot local HTTP server that captures the OAuth redirect.
 *
 * Resolves with the `code` and `state` query params when the browser hits
 * /oauth2callback. Rejects with an Error on timeout or user-visible denial.
 *
 * @param {number} port
 * @param {string} expectedState
 * @returns {Promise<{code: string, state: string}>}
 */
function startRedirectServer(port, expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url?.startsWith(REDIRECT_PATH)) {
        res.writeHead(404).end();
        return;
      }

      const url = new URL(req.url, `http://${REDIRECT_HOST}:${port}`);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      // Always send a response before resolving/rejecting so the browser
      // doesn't hang.
      if (error) {
        const html = buildResponsePage(
          "Authentication denied",
          `Google returned: ${error}. You can close this tab.`,
          false,
        );
        res.writeHead(400, { "Content-Type": "text/html" }).end(html);
        server.close();
        reject(new Error(`Google OAuth denied: ${error}`));
        return;
      }

      if (!code || state !== expectedState) {
        const html = buildResponsePage(
          "Authentication error",
          "Invalid callback. State mismatch or missing code. You can close this tab.",
          false,
        );
        res.writeHead(400, { "Content-Type": "text/html" }).end(html);
        server.close();
        reject(new Error("OAuth callback state mismatch or missing code"));
        return;
      }

      const html = buildResponsePage(
        "Authenticated!",
        "You are now authenticated with Google. You can close this tab and return to the terminal.",
        true,
      );
      res.writeHead(200, { "Content-Type": "text/html" }).end(html);
      server.close();
      resolve({ code, state });
    });

    const timeoutHandle = setTimeout(() => {
      server.close();
      reject(new Error("Authentication timed out (5 minutes). Run 'ndx auth google' to try again."));
    }, TIMEOUT_MS);

    server.on("error", (err) => {
      clearTimeout(timeoutHandle);
      reject(err);
    });

    server.listen(port, REDIRECT_HOST, () => {
      // Server is ready
    });

    server.on("close", () => clearTimeout(timeoutHandle));
  });
}

/**
 * Build a minimal HTML page shown in the browser after the redirect.
 *
 * @param {string} title
 * @param {string} message
 * @param {boolean} success
 * @returns {string}
 */
function buildResponsePage(title, message, success) {
  const color = success ? "#2d7d46" : "#b91c1c";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title} — n-dx</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;color:#1f2937}
h1{color:${color}}p{color:#374151;line-height:1.6}</style></head>
<body><h1>${title}</h1><p>${message}</p></body>
</html>`;
}

// ── Find free port ────────────────────────────────────────────────────────────

/**
 * Find an available TCP port by binding to port 0 (OS assigns).
 *
 * @returns {Promise<number>}
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, REDIRECT_HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// ── Token exchange ────────────────────────────────────────────────────────────

/**
 * Exchange an authorization code for access and refresh tokens.
 *
 * @param {object} params
 * @param {string} params.code           Authorization code from Google.
 * @param {string} params.clientId       OAuth2 client ID.
 * @param {string} params.clientSecret   OAuth2 client secret.
 * @param {string} params.redirectUri    Must match the registered redirect URI.
 * @param {string} params.codeVerifier   PKCE code verifier.
 * @returns {Promise<{access_token:string, refresh_token:string, token_type:string, expires_in:number}>}
 */
async function exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier }) {
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("Token exchange returned no access_token");
  }
  if (!data.refresh_token) {
    throw new Error(
      "Token exchange returned no refresh_token. " +
        "Make sure 'access_type=offline' is set and the user granted offline access.",
    );
  }
  return data;
}

// ── Credential persistence ────────────────────────────────────────────────────

/**
 * Write credentials to the credential file with mode 0600.
 *
 * @param {object} credentials
 * @param {string|undefined} credentialsPath
 */
async function persistCredentials(credentials, credentialsPath) {
  const filePath = resolveCredentialsPath(credentialsPath);
  await mkdir(dirname(filePath), { recursive: true });
  const content = JSON.stringify(credentials, null, 2);
  await writeFile(filePath, content + "\n", { mode: 0o600 });
}

// ── Client credential resolution ──────────────────────────────────────────────

/**
 * Resolve Google OAuth2 client_id and client_secret from config or env.
 *
 * Priority for each:
 *   1. Explicit value from googleConfig (`.n-dx.json` → `llm.google.*`)
 *   2. Environment variable (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`)
 *
 * Returns `{clientId, clientSecret}` where either may be `undefined`.
 *
 * @param {{ client_id?: string, client_secret?: string } | undefined} googleConfig
 * @returns {{ clientId: string|undefined, clientSecret: string|undefined }}
 */
function resolveClientCredentials(googleConfig) {
  const clientId = googleConfig?.client_id ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = googleConfig?.client_secret ?? process.env.GOOGLE_CLIENT_SECRET;
  return { clientId, clientSecret };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the Google OAuth2 browser-launch authorization flow.
 *
 * Prints all user-action prompts, wait messages, and remediation hints in
 * yellow.  Prints the success message in green.
 *
 * @param {object} options
 * @param {{ client_id?: string, client_secret?: string, oauth_credentials_path?: string } | undefined} options.googleConfig
 *   Resolved from `.n-dx.json → llm.google`.
 *
 * @returns {Promise<void>}  Resolves when credentials are persisted.
 * @throws {Error}  When client credentials are missing, the user denies
 *   access, or the exchange fails.
 */
export async function runGoogleOAuthFlow(options = {}) {
  const { googleConfig } = options;

  // ── Resolve client credentials ────────────────────────────────────────────
  const { clientId, clientSecret } = resolveClientCredentials(googleConfig);

  if (!clientId) {
    const msg =
      "Google OAuth2 client_id is not configured.\n" +
      "Set it in .n-dx.json:\n" +
      '  ndx config llm.google.client_id <your-client-id>\n' +
      "Or export GOOGLE_CLIENT_ID=<your-client-id>\n\n" +
      "To obtain a client ID:\n" +
      "  1. Open https://console.cloud.google.com/apis/credentials\n" +
      "  2. Create an OAuth 2.0 Client ID (Application type: Desktop app)\n" +
      "  3. Copy the client ID and run this command again.";
    throw Object.assign(new Error(msg), { isAuthConfig: true });
  }

  if (!clientSecret) {
    const msg =
      "Google OAuth2 client_secret is not configured.\n" +
      "Set it in .n-dx.json:\n" +
      '  ndx config llm.google.client_secret <your-client-secret>\n' +
      "Or export GOOGLE_CLIENT_SECRET=<your-client-secret>";
    throw Object.assign(new Error(msg), { isAuthConfig: true });
  }

  // ── PKCE + state ──────────────────────────────────────────────────────────
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);
  const state = generateState();

  // ── Find an available port ────────────────────────────────────────────────
  const port = await findFreePort();
  const redirectUri = `http://${REDIRECT_HOST}:${port}${REDIRECT_PATH}`;

  // ── Build authorization URL ───────────────────────────────────────────────
  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  // ── Start the redirect server before opening browser ─────────────────────
  const codePromise = startRedirectServer(port, state);

  // ── Print instructions (yellow) and open browser ──────────────────────────
  console.log(yellow("\nOpening Google sign-in in your browser..."));
  console.log(yellow("If the browser does not open automatically, visit:"));
  console.log(yellow(`\n  ${authUrl.toString()}\n`));
  console.log(yellow("Waiting for Google to redirect back (timeout: 5 minutes)..."));

  openBrowser(authUrl.toString());

  // ── Wait for the callback ─────────────────────────────────────────────────
  let code;
  try {
    ({ code } = await codePromise);
  } catch (err) {
    const msg = err.message ?? String(err);
    throw Object.assign(new Error(yellow(msg)), { originalError: err });
  }

  console.log(yellow("\nReceived authorization code. Exchanging for tokens..."));

  // ── Exchange code for tokens ──────────────────────────────────────────────
  let tokenData;
  try {
    tokenData = await exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier });
  } catch (err) {
    const msg = `Token exchange failed: ${err.message}`;
    throw Object.assign(new Error(msg), { originalError: err });
  }

  // ── Persist credentials ───────────────────────────────────────────────────
  const credentials = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_type: tokenData.token_type ?? "Bearer",
    expiry_time: Date.now() + (tokenData.expires_in ?? 3600) * 1_000,
    client_id: clientId,
  };

  const credentialsPath = googleConfig?.oauth_credentials_path;
  await persistCredentials(credentials, credentialsPath);

  const savedPath = resolveCredentialsPath(credentialsPath);
  console.log(green(`\n✓ Authenticated successfully!`));
  console.log(green(`  Credentials saved to: ${savedPath}`));
}
