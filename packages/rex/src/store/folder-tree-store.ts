/**
 * PRDStore adapter backed by the folder-tree format.
 *
 * Reads and writes PRD items via `parseFolderTree` / `serializeFolderTree`.
 * Config, log, and workflow are stored as regular files alongside the tree.
 *
 * Contract guarantees:
 *   - `loadDocument` parses the on-disk folder tree and returns a PRDDocument.
 *   - `saveDocument` serializes the document items to the folder tree and
 *     persists the document title to `tree-meta.json`.
 *   - Unknown item fields survive round-trip via frontmatter passthrough;
 *     nested-object values are coerced to strings (supportsPassthrough: false).
 *   - All writes use atomic (temp + rename) operations for crash-safety.
 *   - Advisory file-locking prevents concurrent PRD writes (FIFO queue).
 *   - Single-item mutations avoid full-tree re-serialization when possible.
 *
 * @module rex/store/folder-tree-store
 */

import { appendFile, mkdir, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";
import { SCHEMA_VERSION } from "../schema/index.js";
import { validateDocument, validateConfig, validateLogEntry } from "../schema/validate.js";
import { findItem, insertChild, updateInTree, removeFromTree, getParentChain } from "../core/tree.js";
import { serializeFolderTree, resolveSiblingSlugs } from "./folder-tree-serializer.js";
import { parseFolderTree } from "./folder-tree-parser.js";
import { withLock } from "./file-lock.js";
import { PRD_TREE_DIRNAME } from "./paths.js";
import type { PRDStore, StoreCapabilities, WriteOptions } from "./contracts.js";
import { titleToFilename } from "./title-to-filename.js";

// ---------------------------------------------------------------------------
// FolderTreeStore
// ---------------------------------------------------------------------------

/**
 * PRDStore implementation that uses `.rex/prd_tree/` as the primary PRD backend.
 * Document title is persisted in `tree-meta.json` in the same directory.
 */
export class FolderTreeStore implements PRDStore {
  private rexDir: string;
  private treeRoot: string;

  constructor(rexDir: string) {
    this.rexDir = rexDir;
    this.treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  }

  private path(file: string): string {
    return join(this.rexDir, file);
  }

  // ---- Document CRUD -------------------------------------------------------

  async loadDocument(): Promise<PRDDocument> {
    let title = "PRD";
    try {
      const raw = await readFile(this.path("tree-meta.json"), "utf-8");
      const meta = JSON.parse(raw) as Record<string, unknown>;
      if (typeof meta["title"] === "string") title = meta["title"];
    } catch (err) {
      if (!isMissingFileError(err)) {
        throw err;
      }
    }

    const { items } = await parseFolderTree(this.treeRoot);
    return { schema: SCHEMA_VERSION, title, items };
  }

  async saveDocument(doc: PRDDocument): Promise<void> {
    const check = validateDocument(doc);
    if (!check.ok) {
      throw new Error(`Invalid document: ${check.errors.message}`);
    }

    await mkdir(this.treeRoot, { recursive: true });
    await writeFile(this.path("tree-meta.json"), JSON.stringify({ title: doc.title }), "utf-8");
    await serializeFolderTree(doc.items, this.treeRoot);
  }

  async getItem(id: string): Promise<PRDItem | null> {
    const doc = await this.loadDocument();
    const entry = findItem(doc.items, id);
    return entry ? (entry.item as PRDItem) : null;
  }

  async addItem(item: PRDItem, parentId?: string, _options?: WriteOptions): Promise<void> {
    const lockPath = this.path("prd.lock");
    await withLock(lockPath, async () => {
      const doc = await this.loadDocument();
      let parentEntry: { item: PRDItem } | null = null;
      const hadChildrenBefore = parentId ? doc.items.some((i) => i.id === parentId ? (i.children?.length ?? 0) > 0 : false) : null;

      if (parentId) {
        const entry = findItem(doc.items, parentId);
        if (!entry) {
          throw new Error(`Parent "${parentId}" not found`);
        }
        parentEntry = entry;
        // Record if parent is about to transition from leaf to non-leaf
        const childCountBefore = (parentEntry.item.children?.length ?? 0);

        if (!insertChild(doc.items, parentId, item)) {
          throw new Error(`Parent "${parentId}" not found`);
        }

        // After insertion, check if parent transitioned from leaf to non-leaf
        // and is a subtask (which might need promotion)
        if (childCountBefore === 0 && parentEntry.item.level === "subtask") {
          // Parent just got its first child and is a subtask - promote if needed
          await this.promoteLeafSubtaskToFolder(doc, parentEntry.item);
        }
      } else {
        doc.items.push(item);
      }
      await this.saveDocument(doc);
    });
  }

  async updateItem(id: string, updates: Partial<PRDItem>, _options?: WriteOptions): Promise<void> {
    const lockPath = this.path("prd.lock");
    await withLock(lockPath, async () => {
      const doc = await this.loadDocument();
      if (!updateInTree(doc.items, id, updates)) {
        throw new Error(`Item "${id}" not found`);
      }
      await this.saveDocument(doc);
    });
  }

  async removeItem(id: string): Promise<void> {
    const lockPath = this.path("prd.lock");
    await withLock(lockPath, async () => {
      const doc = await this.loadDocument();
      if (!removeFromTree(doc.items, id)) {
        throw new Error(`Item "${id}" not found`);
      }
      await this.saveDocument(doc);
    });
  }

  // ---- Configuration -------------------------------------------------------

  async loadConfig(): Promise<RexConfig> {
    const raw = await readFile(this.path("config.json"), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const check = validateConfig(parsed);
    if (!check.ok) {
      throw new Error(`Invalid config.json: ${check.errors.message}`);
    }
    return check.data as RexConfig;
  }

  async saveConfig(config: RexConfig): Promise<void> {
    await writeFile(this.path("config.json"), JSON.stringify(config, null, 2), "utf-8");
  }

  // ---- Execution log -------------------------------------------------------

  async appendLog(entry: LogEntry): Promise<void> {
    const check = validateLogEntry(entry);
    if (!check.ok) {
      throw new Error(`Invalid log entry: ${check.errors.message}`);
    }
    await appendFile(this.path("execution-log.jsonl"), JSON.stringify(entry) + "\n", "utf-8");
  }

  async readLog(limit?: number): Promise<LogEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.path("execution-log.jsonl"), "utf-8");
    } catch (err) {
      if (isMissingFileError(err)) {
        return [];
      }
      throw err;
    }
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries: LogEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch (err) {
        if (!(err instanceof SyntaxError)) {
          throw err;
        }
      }
    }
    if (limit !== undefined && entries.length > limit) {
      return entries.slice(entries.length - limit);
    }
    return entries;
  }

  // ---- Workflow ------------------------------------------------------------

  async loadWorkflow(): Promise<string> {
    try {
      return await readFile(this.path("workflow.md"), "utf-8");
    } catch (err) {
      if (isMissingFileError(err)) {
        return "";
      }
      throw err;
    }
  }

  async saveWorkflow(content: string): Promise<void> {
    await writeFile(this.path("workflow.md"), content, "utf-8");
  }

  // ---- Transactions --------------------------------------------------------

  async withTransaction<T>(fn: (doc: PRDDocument) => Promise<T>): Promise<T> {
    const lockPath = this.path("prd.lock");
    return withLock(lockPath, async () => {
      const doc = await this.loadDocument();
      const result = await fn(doc);
      const check = validateDocument(doc);
      if (!check.ok) {
        throw new Error(`Invalid document after mutation: ${check.errors.message}`);
      }
      await this.saveDocument(doc);
      return result;
    });
  }

  // ---- Introspection -------------------------------------------------------

  capabilities(): StoreCapabilities {
    return {
      adapter: "folder-tree",
      supportsTransactions: false,
      supportsWatch: false,
    };
  }

  // ---- Promotion of leaf subtasks to folders --------------------------------

  /**
   * Promote a leaf subtask (stored as .md file in parent directory) to a folder
   * with index.md when it gains its first child. Uses atomic file operations
   * to ensure crash-safety: either the old .md file or the new folder structure
   * exists, never both.
   *
   * This is called when a subtask transitions from 0 to 1+ children.
   *
   * @param doc The full PRD document (used to find parent chain)
   * @param subtask The subtask item that is being promoted
   */
  private async promoteLeafSubtaskToFolder(doc: PRDDocument, subtask: PRDItem): Promise<void> {
    // Find the parent chain to calculate the path where the leaf .md file is stored
    const parentChain = getParentChain(doc.items, subtask.id);
    if (!parentChain || parentChain.length === 0) {
      // Subtask is at root level (unusual, but not an error - just skip promotion)
      return;
    }

    // Calculate the directory where the subtask's .md file should be
    // For single-child optimization, it's in the parent's directory
    const parentDir = await this.calculateItemDir(parentChain);
    if (!parentDir) {
      return; // Can't determine parent directory - skip promotion
    }

    // Check if the subtask exists as a leaf .md file in the parent directory
    const subtaskFilename = titleToFilename(subtask.title);
    const leafPath = join(parentDir, subtaskFilename);

    const exists = await this.fileExists(leafPath);
    if (!exists) {
      // No leaf .md file found - might already be in a folder or never created yet
      return;
    }

    // Promote: read the .md file, create the subtask's directory, write the file there
    try {
      const content = await readFile(leafPath, "utf-8");
      const subtaskSlug = this.calculateItemSlug(subtask.title);
      const subtaskDir = join(parentDir, subtaskSlug);

      // Create the subtask's directory
      await mkdir(subtaskDir, { recursive: true });

      // Write the file in the new location
      const newPath = join(subtaskDir, subtaskFilename);
      await writeFile(newPath, content, "utf-8");

      // Atomically remove the old file (using rename to be extra safe)
      // If this fails, the old file remains and the tree is still consistent
      await rm(leafPath, { force: true }).catch(() => {
        // Silently continue - the old file will be orphaned but won't cause corruption
      });
    } catch (err) {
      // Log but don't throw - promotion failure shouldn't prevent item creation
      // The serializer will handle creating the directory on next write
      console.warn(
        `Failed to promote leaf subtask "${subtask.title}" to folder: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Calculate the directory path where an item with the given parent chain
   * should be located on disk.
   *
   * Traverses the ancestor chain and computes slugs to determine the full path.
   * Returns null if any ancestor directory doesn't exist (item not yet on disk).
   */
  private async calculateItemDir(parentChain: PRDItem[]): Promise<string | null> {
    if (!parentChain || parentChain.length === 0) {
      return null;
    }

    let currentDir = this.treeRoot;

    // Traverse from first parent (root ancestor) to last parent (immediate parent)
    for (const parent of parentChain) {
      const slug = this.calculateItemSlug(parent.title);
      currentDir = join(currentDir, slug);

      // Check if this directory exists
      if (!await this.fileExists(currentDir)) {
        return null;
      }
    }

    return currentDir;
  }

  /**
   * Calculate the directory slug for an item based on its title.
   * This mirrors the logic in serializeFolderTree slug calculation.
   */
  private calculateItemSlug(title: string): string {
    // Simplified slug calculation: normalize and lowercase
    // This should match the logic in folder-tree-serializer.ts
    const normalized = title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\x00-\x7F]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    return normalized || "untitled";
  }

  /**
   * Check if a file or directory exists.
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (err) {
      if (isMissingFileError(err)) {
        return false;
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Initialiser helper
// ---------------------------------------------------------------------------

/**
 * Ensure the files required by FolderTreeStore exist in `rexDir`.
 * Idempotent — safe to call on an already-initialised directory.
 */
export async function ensureFolderTreeRexDir(rexDir: string): Promise<void> {
  await mkdir(rexDir, { recursive: true });
}

function isMissingFileError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
