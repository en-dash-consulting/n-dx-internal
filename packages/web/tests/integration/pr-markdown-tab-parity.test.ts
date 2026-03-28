// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR Markdown migration integration tests.
 *
 * The PR Markdown tab has been removed from the dashboard and replaced by
 * the /pr-description Claude Code skill. These tests verify:
 * - The PR Markdown tab no longer appears in the SourceVision sidebar
 * - Navigating to /pr-markdown shows a clear migration message
 */

function createStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function ensureBrowserStubs(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createStorageStub(),
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: globalThis.localStorage,
  });

  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (typeof HTMLElement.prototype.scrollTo !== "function") {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => {},
    });
  }
}

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function wait(ms: number = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 8_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(20);
    } else {
      await wait(20);
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function findNavItem(label: string): HTMLElement | null {
  const navItems = Array.from(document.querySelectorAll(".nav-item"));
  return (navItems.find((item) => item.textContent?.includes(label)) ?? null) as HTMLElement | null;
}

async function bootViewer(url: string, fetchImpl: typeof fetch): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState({}, "", url);
  vi.stubGlobal("fetch", fetchImpl);

  vi.resetModules();
  await import("../../src/viewer/main.js");

  await waitFor(() => document.querySelector(".sidebar") !== null);
}

function createMockApi(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === "/api/config") return jsonResponse({ scope: "sourcevision" });
    if (url === "/api/project") return jsonResponse({ name: "n-dx", description: null, version: null, git: null, nameSource: "directory" });
    if (url === "/api/status") {
      return jsonResponse({
        sv: { freshness: "fresh", analyzedAt: null, minutesAgo: 0, modulesComplete: 0, modulesTotal: 0 },
        rex: { exists: false, percentComplete: 0, stats: null, hasInProgress: false, hasPending: false, nextTaskTitle: null },
        hench: { configured: false, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
      });
    }

    if (url === "/data") return jsonResponse({}, 404);

    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;
}

describe("PR Markdown migration integration", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    ensureBrowserStubs();
    localStorage.removeItem("sidebar-collapsed");
    localStorage.removeItem("sidebar-expanded-section");
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not show PR Markdown as a SourceVision tab", async () => {
    await bootViewer("/overview", createMockApi());

    const zonesItem = findNavItem("Zones");
    const prMarkdownItem = findNavItem("PR Markdown");
    expect(zonesItem).not.toBeNull();
    expect(prMarkdownItem).toBeNull();
  });

  it("shows migration message when navigating to /pr-markdown", async () => {
    await bootViewer("/pr-markdown", createMockApi());

    await waitFor(() => document.body.textContent?.includes("PR Markdown has moved") ?? false);
    expect(document.body.textContent).toContain("/pr-description");
    expect(document.body.textContent).toContain("Claude Code skill");
  });
});
