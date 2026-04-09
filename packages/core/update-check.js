/**
 * Non-blocking npm registry version check with 24-hour TTL cache.
 *
 * Usage:
 *   import { getUpdateNotice } from "./update-check.js";
 *   const notice = getUpdateNotice(currentVersion);
 *   if (notice) process.stdout.write(notice + "\n");
 *
 * Design:
 * - `getUpdateNotice` is fully synchronous — it reads from the disk cache
 *   and returns immediately, never awaiting a network call.
 * - If the cache is stale (> 24 hours) or missing, a background fetch is
 *   fired (fire-and-forget) to populate the cache for the next run.
 * - The current run is never blocked or delayed.
 *
 * Cache location: os.tmpdir()/n-dx-update-check.json
 *
 * @module update-check
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Default cache file path — OS temp directory. */
export const DEFAULT_CACHE_FILE = join(tmpdir(), "n-dx-update-check.json");

/** Cache freshness window. */
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** npm registry endpoint for the latest @n-dx/core release. */
const REGISTRY_URL = "https://registry.npmjs.org/@n-dx/core/latest";

// ── Semver helpers ────────────────────────────────────────────────────────────

/**
 * Return true if semver string `a` is strictly newer than semver string `b`.
 *
 * Only handles simple major.minor.patch versions.
 * Pre-release suffixes (e.g. "1.0.0-alpha.1") are compared by tuple only —
 * the suffix is ignored, which means this function may report a pre-release
 * as newer than a stable release with the same tuple; acceptable for a
 * notification-only use case.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function isNewer(a, b) {
  if (!a || !b) return false;
  try {
    const parse = (v) =>
      v
        .replace(/^v/, "")
        .split("-")[0] // strip pre-release suffix
        .split(".")
        .map(Number);
    const [aMaj, aMin, aPatch] = parse(a);
    const [bMaj, bMin, bPatch] = parse(b);
    if (!Number.isFinite(aMaj) || !Number.isFinite(bMaj)) return false;
    if (aMaj !== bMaj) return aMaj > bMaj;
    if (aMin !== bMin) return aMin > bMin;
    return aPatch > bPatch;
  } catch {
    return false;
  }
}

// ── Cache I/O ─────────────────────────────────────────────────────────────────

/**
 * Read the update check cache file.
 *
 * @param {string} cacheFile
 * @returns {{ latestVersion: string, checkedAt: number } | null}
 */
export function readCache(cacheFile) {
  try {
    const raw = readFileSync(cacheFile, "utf-8");
    const data = JSON.parse(raw);
    if (
      data &&
      typeof data === "object" &&
      typeof data.latestVersion === "string" &&
      typeof data.checkedAt === "number"
    ) {
      return data;
    }
  } catch {
    // Cache miss or corrupt — treat as absent
  }
  return null;
}

/**
 * Write to the update check cache file.
 * Errors (e.g. read-only filesystem) are silently ignored.
 *
 * @param {string} cacheFile
 * @param {{ latestVersion: string, checkedAt: number }} data
 */
export function writeCache(cacheFile, data) {
  try {
    writeFileSync(cacheFile, JSON.stringify(data, null, 2) + "\n", "utf-8");
  } catch {
    // Ignore write errors — a missing cache is a non-critical failure
  }
}

// ── Network fetch ─────────────────────────────────────────────────────────────

/**
 * Fetch the latest @n-dx/core version from the npm registry.
 *
 * Returns null on any failure (network error, timeout, parse error).
 * Times out after 5 seconds.
 *
 * @returns {Promise<string | null>}
 */
async function fetchLatestVersion() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(REGISTRY_URL, {
        signal: controller.signal,
        headers: { "User-Agent": "n-dx-cli" },
      });
      if (!response.ok) return null;
      const data = await response.json();
      return typeof data?.version === "string" ? data.version : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

// ── Background refresh ────────────────────────────────────────────────────────

/**
 * Fire-and-forget: fetch the latest version and write it to the cache.
 * The caller is never awaited or blocked.
 *
 * @param {string} cacheFile
 * @param {() => Promise<string | null>} [_fetch] - Injectable for testing
 */
export function refreshCacheInBackground(cacheFile, _fetch = fetchLatestVersion) {
  void _fetch()
    .then((version) => {
      if (version) {
        writeCache(cacheFile, { latestVersion: version, checkedAt: Date.now() });
      }
    })
    .catch(() => {
      // Silently ignore fetch errors — this is a best-effort background check.
      // `fetchLatestVersion` already returns null on failure, but we guard
      // here too for injected test stubs that may throw instead.
    });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a notice string when a newer @n-dx/core version is available,
 * or null when no notice should be shown.
 *
 * Behaviour summary:
 * 1. Reads the cache file synchronously (no network wait).
 * 2. If the cache is fresh (< 24 h old): use it as-is.
 * 3. If the cache is stale or missing: start a background refresh for the
 *    next run (still show from a stale cache if it has a newer version).
 * 4. Returns null if the current version is already up to date.
 *
 * @param {string} currentVersion - The currently installed version (from package.json)
 * @param {object} [opts] - Test overrides
 * @param {string} [opts.cacheFile] - Override cache file path
 * @param {() => Promise<string | null>} [opts._fetch] - Override fetch function
 * @returns {string | null}
 */
export function getUpdateNotice(currentVersion, opts = {}) {
  const cacheFile = opts.cacheFile ?? DEFAULT_CACHE_FILE;
  const cache = readCache(cacheFile);

  const isFresh = cache !== null && Date.now() - cache.checkedAt < TTL_MS;

  if (!isFresh) {
    // Cache is stale or absent — refresh in background for the next run
    refreshCacheInBackground(cacheFile, opts._fetch);
  }

  if (cache && isNewer(cache.latestVersion, currentVersion)) {
    return formatNotice(cache.latestVersion);
  }

  return null;
}

/**
 * Format the human-readable update notification.
 *
 * @param {string} latestVersion
 * @returns {string}
 */
function formatNotice(latestVersion) {
  return `\n  Update available! n-dx ${latestVersion}  →  npm install -g @n-dx/core`;
}
