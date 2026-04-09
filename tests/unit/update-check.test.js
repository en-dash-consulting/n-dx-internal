import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isNewerVersion,
  checkForUpdate,
  formatUpdateNotice,
  CACHE_TTL_MS,
  CACHE_FILE,
} from "../../packages/core/update-check.js";

// ── Module-level mocks ────────────────────────────────────────────────────────
// vi.mock() calls are hoisted to the top by Vitest, so they take effect before
// the module under test is first imported.

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Import the mocked fs/promises so we can configure each test's stubs.
const fsMod = await import("node:fs/promises");
const { readFile, writeFile } = fsMod;

// ── isNewerVersion ────────────────────────────────────────────────────────────

describe("isNewerVersion", () => {
  it("returns true when major is higher", () => {
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
  });

  it("returns true when minor is higher", () => {
    expect(isNewerVersion("0.3.0", "0.2.9")).toBe(true);
  });

  it("returns true when patch is higher", () => {
    expect(isNewerVersion("0.2.3", "0.2.2")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(isNewerVersion("0.2.2", "0.2.2")).toBe(false);
  });

  it("returns false when candidate is older (lower major)", () => {
    expect(isNewerVersion("0.9.9", "1.0.0")).toBe(false);
  });

  it("returns false when candidate is older (lower minor)", () => {
    expect(isNewerVersion("0.1.9", "0.2.0")).toBe(false);
  });

  it("returns false when candidate is older (lower patch)", () => {
    expect(isNewerVersion("0.2.1", "0.2.2")).toBe(false);
  });

  it("ignores pre-release suffixes", () => {
    expect(isNewerVersion("0.3.0-beta.1", "0.2.2")).toBe(true);
    expect(isNewerVersion("0.2.2-rc.1", "0.2.2")).toBe(false);
  });
});

// ── formatUpdateNotice ────────────────────────────────────────────────────────

describe("formatUpdateNotice", () => {
  it("contains both versions", () => {
    const notice = formatUpdateNotice("0.2.2", "0.3.0");
    expect(notice).toContain("0.2.2");
    expect(notice).toContain("0.3.0");
  });

  it("contains the install command", () => {
    const notice = formatUpdateNotice("0.2.2", "0.3.0");
    expect(notice).toContain("npm install -g @n-dx/core");
  });

  it("starts with a newline for visual separation", () => {
    const notice = formatUpdateNotice("0.2.2", "0.3.0");
    expect(notice).toMatch(/^\n/);
  });
});

// ── checkForUpdate ────────────────────────────────────────────────────────────

describe("checkForUpdate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(fsMod.mkdir).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null if installed version matches fresh cache", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ latestVersion: "0.2.2", checkedAt: Date.now() }),
    );
    expect(await checkForUpdate("0.2.2")).toBeNull();
  });

  it("returns latestVersion when a newer version is in fresh cache", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ latestVersion: "0.3.0", checkedAt: Date.now() }),
    );
    expect(await checkForUpdate("0.2.2")).toBe("0.3.0");
  });

  it("returns null if registry fetch fails and no cache exists", async () => {
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await checkForUpdate("0.2.2")).toBeNull();
  });

  it("returns null if registry returns non-OK response and no cache exists", async () => {
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    expect(await checkForUpdate("0.2.2")).toBeNull();
  });

  it("fetches from registry when cache is stale", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        latestVersion: "0.2.0",
        checkedAt: Date.now() - CACHE_TTL_MS - 1,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "0.3.0" }),
      }),
    );
    const result = await checkForUpdate("0.2.2");
    expect(result).toBe("0.3.0");
  });

  it("writes new cache after a successful registry fetch", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        latestVersion: "0.2.0",
        checkedAt: Date.now() - CACHE_TTL_MS - 1,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "0.3.0" }),
      }),
    );
    await checkForUpdate("0.2.2");
    // writeCache fires a background void — wait a tick for it to run
    await new Promise((r) => setTimeout(r, 10));
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      CACHE_FILE,
      expect.stringContaining("0.3.0"),
      "utf-8",
    );
  });

  it("falls back to stale cache if registry fetch fails", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        latestVersion: "0.3.0",
        checkedAt: Date.now() - CACHE_TTL_MS - 1,
      }),
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    // Stale cache has a newer version — should still surface it
    expect(await checkForUpdate("0.2.2")).toBe("0.3.0");
  });

  it("never throws even if fs and fetch both fail", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("catastrophic"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => { throw new Error("catastrophic"); }),
    );
    await expect(checkForUpdate("0.2.2")).resolves.toBeNull();
  });
});
