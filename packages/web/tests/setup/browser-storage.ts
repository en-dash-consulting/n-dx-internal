import { beforeEach } from "vitest";

function createStorageStub(): Storage {
  const store = new Map<string, string>();

  const storage = {
    get length() {
      return store.size;
    },
    clear() {
      for (const key of Array.from(store.keys())) {
        delete (storage as Record<string, unknown>)[key];
      }
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
      delete (storage as Record<string, unknown>)[key];
    },
    setItem(key: string, value: string) {
      const normalized = String(value);
      store.set(key, normalized);
      Object.defineProperty(storage, key, {
        configurable: true,
        enumerable: true,
        get: () => store.get(key),
        set: (next: unknown) => {
          storage.setItem(key, String(next));
        },
      });
    },
  };

  return storage as Storage;
}

function installStorage(name: "localStorage" | "sessionStorage"): void {
  const storage = createStorageStub();

  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: storage,
  });

  if (typeof window !== "undefined") {
    Object.defineProperty(window, name, {
      configurable: true,
      value: storage,
    });
  }
}

beforeEach(() => {
  installStorage("localStorage");
  installStorage("sessionStorage");
});
