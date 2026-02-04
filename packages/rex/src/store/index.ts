export type { PRDStore, StoreCapabilities } from "./types.js";
export { FileStore, ensureRexDir } from "./file-adapter.js";

import { FileStore } from "./file-adapter.js";
import type { PRDStore } from "./types.js";

export function createStore(adapter: string, rexDir: string): PRDStore {
  switch (adapter) {
    case "file":
      return new FileStore(rexDir);
    default:
      throw new Error(
        `Unknown adapter "${adapter}". Available adapters: file`,
      );
  }
}
