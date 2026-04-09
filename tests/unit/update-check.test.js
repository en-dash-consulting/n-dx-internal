/**
 * Unit tests for packages/core/update-check.js
 *
 * Tests cover:
 * - isNewer() semver comparison
 * - readCache() / writeCache() disk round-trip
 * - getUpdateNotice() logic (fresh cache, stale cache, no cache)
 * - Background refresh triggered only when cache is stale/absent
 * - Quiet conditions (TTY & quiet-flag checks are in cli.js, not this module)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isNewer,
  readCache,
  writeCache,
  getUpdateNotice,
  refreshCacheInBackground,
} from "../../packages/core/update-check.js";

// ── isNewer ──────────────────────────────────────────────────────────────────

describe("isNewer", () => {
  it("returns true when major is higher", () => {
    expect(isNewer("2.0.0", "1.9.9")).toBe(true);
  });

  it("returns true when minor is higher (same major)", () => {
    expect(isNewer("1.3.0", "1.2.9")).toBe(true);
  });

  it("returns true when patch is higher (same major.minor)", () => {
    expect(isNewer("1.2.4", "1.2.3")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(isNewer("1.2.3", "1.2.3")).toBe(false);
  });

  it("returns false when candidate is older (patch)", () => {
    expect(isNewer("1.2.2", "1.2.3")).toBe(false);
  });

  it("returns false when candidate is older (minor)", () => {
    expect(isNewer("1.1.9", "1.2.0")).toBe(false);
  });

  it("returns false when candidate is older (major)", () => {
    expect(isNewer("1.0.0", "2.0.0")).toBe(false);
  });

  it("strips a leading v prefix", () => {
    expect(isNewer("v1.2.4", "v1.2.3")).toBe(true);
    expect(isNewer("v1.2.3", "v1.2.3")).toBe(false);
  });

  it("ignores pre-release suffix (compares tuple only)", () => {
    expect(isNewer("1.2.4-beta.1", "1.2.3")).toBe(true);
    expect(isNewer("1.2.3-alpha.1", "1.2.3")).toBe(false);
  });

  it("returns false when either argument is falsy", () => {
    expect(isNewer("", "1.2.3")).toBe(false);
    expect(isNewer("1.2.3", "")).toBe(false);
    expect(isNewer(null, "1.2.3")).toBe(false);
    expect(isNewer("1.2.3", null)).toBe(false);
  });

  it("returns false for non-numeric version segments", () => {
    expect(isNewer("abc", "1.2.3")).toBe(false);
  });
});

// ── readCache / writeCache ────────────────────────────────────────────────────

describe("readCache / writeCache", () => {
  let tmpDir;
  let cacheFile;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-update-test-"));
    cacheFile = join(tmpDir, "update-check.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("readCache returns null when the file does not exist", () => {
    expect(readCache(cacheFile)).toBeNull();
  });

  it("writeCache + readCache round-trips the data", () => {
    const data = { latestVersion: "1.5.0", checkedAt: 1712345678000 };
    writeCache(cacheFile, data);
    expect(readCache(cacheFile)).toEqual(data);
  });

  it("readCache returns null for a corrupt file", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(cacheFile, "not json", "utf-8");
    expect(readCache(cacheFile)).toBeNull();
  });

  it("readCache returns null when required fields are missing", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(cacheFile, JSON.stringify({ latestVersion: "1.0.0" }), "utf-8");
    expect(readCache(cacheFile)).toBeNull();
  });

  it("writeCache silently ignores write errors (non-existent parent dir)", () => {
    const badPath = join(tmpDir, "nonexistent", "subdir", "cache.json");
    expect(() => writeCache(badPath, { latestVersion: "1.0.0", checkedAt: Date.now() })).not.toThrow();
  });
});

// ── getUpdateNotice ───────────────────────────────────────────────────────────

describe("getUpdateNotice", () => {
  let tmpDir;
  let cacheFile;
  const CURRENT = "1.2.3";
  const NEWER = "1.2.4";
  const OLDER = "1.2.2";

  // A no-op fetch stub — background refresh should not produce observable side
  // effects in these synchronous tests.
  const noopFetch = () => new Promise(() => {}); // never resolves

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-update-notice-"));
    cacheFile = join(tmpDir, "update-check.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no cache exists", () => {
    const result = getUpdateNotice(CURRENT, { cacheFile, _fetch: noopFetch });
    expect(result).toBeNull();
  });

  it("returns null when cache has the same version", () => {
    writeCache(cacheFile, { latestVersion: CURRENT, checkedAt: Date.now() });
    const result = getUpdateNotice(CURRENT, { cacheFile, _fetch: noopFetch });
    expect(result).toBeNull();
  });

  it("returns null when cache has an older version than current", () => {
    writeCache(cacheFile, { latestVersion: OLDER, checkedAt: Date.now() });
    const result = getUpdateNotice(CURRENT, { cacheFile, _fetch: noopFetch });
    expect(result).toBeNull();
  });

  it("returns a notice string when cache has a newer version (fresh cache)", () => {
    writeCache(cacheFile, { latestVersion: NEWER, checkedAt: Date.now() });
    const result = getUpdateNotice(CURRENT, { cacheFile, _fetch: noopFetch });
    expect(result).toBeTypeOf("string");
    expect(result).toContain(NEWER);
  });

  it("notice includes an upgrade command", () => {
    writeCache(cacheFile, { latestVersion: NEWER, checkedAt: Date.now() });
    const result = getUpdateNotice(CURRENT, { cacheFile, _fetch: noopFetch });
    expect(result).toContain("npm install");
    expect(result).toContain("@n-dx/core");
  });

  it("returns a notice from a stale cache when it has a newer version", () => {
    const staleTime = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    writeCache(cacheFile, { latestVersion: NEWER, checkedAt: staleTime });
    const result = getUpdateNotice(CURRENT, { cacheFile, _fetch: noopFetch });
    expect(result).toBeTypeOf("string");
    expect(result).toContain(NEWER);
  });

  it("returns null from a stale cache with same/older version", () => {
    const staleTime = Date.now() - 25 * 60 * 60 * 1000;
    writeCache(cacheFile, { latestVersion: CURRENT, checkedAt: staleTime });
    const result = getUpdateNotice(CURRENT, { cacheFile, _fetch: noopFetch });
    expect(result).toBeNull();
  });

  it("triggers a background refresh when cache is missing", () => {
    const fetchCalled = vi.fn(() => new Promise(() => {}));
    getUpdateNotice(CURRENT, { cacheFile, _fetch: fetchCalled });
    expect(fetchCalled).toHaveBeenCalledOnce();
  });

  it("triggers a background refresh when cache is stale", () => {
    const staleTime = Date.now() - 25 * 60 * 60 * 1000;
    writeCache(cacheFile, { latestVersion: CURRENT, checkedAt: staleTime });
    const fetchCalled = vi.fn(() => new Promise(() => {}));
    getUpdateNotice(CURRENT, { cacheFile, _fetch: fetchCalled });
    expect(fetchCalled).toHaveBeenCalledOnce();
  });

  it("does NOT trigger a background refresh when cache is fresh", () => {
    writeCache(cacheFile, { latestVersion: CURRENT, checkedAt: Date.now() });
    const fetchCalled = vi.fn(() => new Promise(() => {}));
    getUpdateNotice(CURRENT, { cacheFile, _fetch: fetchCalled });
    expect(fetchCalled).not.toHaveBeenCalled();
  });
});

// ── refreshCacheInBackground ──────────────────────────────────────────────────

describe("refreshCacheInBackground", () => {
  let tmpDir;
  let cacheFile;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-update-refresh-"));
    cacheFile = join(tmpDir, "update-check.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a new cache entry when the fetch resolves successfully", async () => {
    const fakeFetch = async () => "2.0.0";
    refreshCacheInBackground(cacheFile, fakeFetch);
    // Flush microtasks so the async fetch resolves and the cache is written
    await new Promise((r) => setTimeout(r, 0));
    const cache = readCache(cacheFile);
    expect(cache?.latestVersion).toBe("2.0.0");
    expect(cache?.checkedAt).toBeGreaterThan(0);
  });

  it("does not throw when fetch returns null", async () => {
    const fakeFetch = async () => null;
    expect(() => refreshCacheInBackground(cacheFile, fakeFetch)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    // No cache file should exist
    expect(readCache(cacheFile)).toBeNull();
  });

  it("does not throw when fetch rejects", async () => {
    const fakeFetch = async () => { throw new Error("network error"); };
    expect(() => refreshCacheInBackground(cacheFile, fakeFetch)).not.toThrow();
  });
});
