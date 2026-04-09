/**
 * Non-blocking update availability check for @n-dx/core.
 *
 * Fetches the latest version from the npm registry and compares against
 * the currently installed version. Caches the result with a 24-hour TTL
 * to avoid repeated network calls on every command invocation.
 *
 * Cache location: ~/.n-dx/update-check.json
 *
 * Design principles:
 * - Never throws — all errors are swallowed and return null.
 * - The result promise is started early and raced against a short timeout
 *   in the CLI so command output is never delayed.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** npm registry endpoint for the latest published @n-dx/core version. */
export const REGISTRY_URL = "https://registry.npmjs.org/@n-dx/core/latest";

/** User-level cache directory for the update check result. */
export const CACHE_DIR = join(homedir(), ".n-dx");

/** Path to the cached update check result. */
export const CACHE_FILE = join(CACHE_DIR, "update-check.json");

/** Cache TTL: 24 hours in milliseconds. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum time to wait for the npm registry response. */
const FETCH_TIMEOUT_MS = 3000;

/**
 * @typedef {{ latestVersion: string; checkedAt: number }} UpdateCheckCache
 */

/**
 * Read the cached update check result from disk.
 * Returns null if the cache file is missing, malformed, or unreadable.
 *
 * @returns {Promise<UpdateCheckCache | null>}
 */
async function readCache() {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (
      typeof data.latestVersion === "string" &&
      typeof data.checkedAt === "number"
    ) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist the latest version to the user-level cache file.
 * Silently ignores write errors (e.g. read-only filesystem).
 *
 * @param {string} latestVersion
 */
async function writeCache(latestVersion) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(
      CACHE_FILE,
      JSON.stringify({ latestVersion, checkedAt: Date.now() }),
      "utf-8",
    );
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Fetch the latest @n-dx/core version from the npm registry.
 * Returns null if the request fails or times out.
 *
 * @returns {Promise<string | null>}
 */
async function fetchLatestVersion() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compare two semver strings and return true if `candidate` is strictly
 * newer than `installed`. Pre-release suffixes (e.g. `-beta.1`) are
 * ignored — only the numeric major.minor.patch triplet is compared.
 *
 * @param {string} candidate - Version string to test (e.g. "0.3.0")
 * @param {string} installed - Currently installed version (e.g. "0.2.2")
 * @returns {boolean}
 */
export function isNewerVersion(candidate, installed) {
  const parse = (v) => {
    const parts = String(v)
      .split("-")[0]
      .split(".")
      .map(Number);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [cMaj, cMin, cPat] = parse(candidate);
  const [iMaj, iMin, iPat] = parse(installed);
  if (cMaj !== iMaj) return cMaj > iMaj;
  if (cMin !== iMin) return cMin > iMin;
  return cPat > iPat;
}

/**
 * Check whether a newer version of @n-dx/core is available on npm.
 *
 * Returns the latest version string if it is strictly newer than
 * `currentVersion`, or `null` if the installed version is current,
 * the check failed, or the registry is unreachable.
 *
 * This function never throws.
 *
 * @param {string} currentVersion - The currently installed version (e.g. "0.2.2")
 * @returns {Promise<string | null>}
 */
export async function checkForUpdate(currentVersion) {
  try {
    // Attempt to read a fresh cache entry first (avoids network call).
    const cache = await readCache();
    let latestVersion;

    if (cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
      // Cache hit — use the stored version without touching the network.
      latestVersion = cache.latestVersion;
    } else {
      // Cache miss or stale — fetch from the npm registry.
      const fetched = await fetchLatestVersion();
      if (fetched) {
        latestVersion = fetched;
        // Fire-and-forget cache write so we don't delay the caller.
        void writeCache(latestVersion);
      } else if (cache) {
        // Fetch failed but a stale cache entry exists — use it silently.
        latestVersion = cache.latestVersion;
      } else {
        // No cache and no network — nothing to compare.
        return null;
      }
    }

    return isNewerVersion(latestVersion, currentVersion) ? latestVersion : null;
  } catch {
    return null;
  }
}

/**
 * Format the single-line update notice printed after command output.
 *
 * @param {string} currentVersion - Currently installed version
 * @param {string} latestVersion  - Newer version available on npm
 * @returns {string}
 */
export function formatUpdateNotice(currentVersion, latestVersion) {
  return (
    `\n  Update available: ${currentVersion} → ${latestVersion}\n` +
    `  Run: npm install -g @n-dx/core\n`
  );
}
