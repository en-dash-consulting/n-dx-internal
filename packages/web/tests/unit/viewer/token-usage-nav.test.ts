// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { Sidebar } from "../../../src/viewer/components/sidebar.js";

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
}

describe("token usage sidebar navigation", () => {
  beforeEach(() => {
    ensureBrowserStubs();
  });

  it("renders Token Usage as the active rex nav item when view=token-usage", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    render(
      h(Sidebar, {
        view: "token-usage",
        onNavigate: vi.fn(),
        manifest: null,
        zones: null,
        sidebarCollapsed: false,
        onToggleSidebar: vi.fn(),
      }),
      root,
    );

    const active = root.querySelector(".nav-item.active");
    expect(active?.textContent).toContain("Token Usage");
    expect(active?.getAttribute("aria-current")).toBe("page");
  });
});
