/**
 * Migration pass for flattening single-child wrapper directories in the PRD folder tree.
 *
 * When the serializer detects a feature/task with exactly one child, it skips creating
 * a parent directory and instead embeds parent metadata in the child using __parent* fields.
 * This migration pass performs the inverse operation on existing PRD trees that don't yet
 * have this optimization applied.
 *
 * For each directory D with exactly one child subdirectory and an index.md:
 *   1. Check if child already has __parent* fields (idempotent check)
 *   2. If not optimized yet:
 *      - Extract parent metadata from D's index.md
 *      - Embed parent metadata into child's .md file(s)
 *      - Move child to D's parent directory
 *      - Delete the now-empty D
 *
 * The migration is idempotent: running it twice on the same tree produces no changes.
 *
 * @module core/compact-single-children
 */

import { readdir, readFile, writeFile, rm, rename, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Result of running the single-child compaction migration.
 */
export interface CompactionResult {
  /** Number of directories that were compacted. */
  compactedCount: number;
  /** Errors encountered during compaction. */
  errors: Array<{ path: string; error: string }>;
}

/**
 * Scan the folder tree and compact all single-child directories.
 * Returns a summary of how many were compacted.
 */
export async function compactSingleChildren(treeRoot: string): Promise<CompactionResult> {
  const result: CompactionResult = {
    compactedCount: 0,
    errors: [],
  };

  const rootExists = await stat(treeRoot)
    .then((s) => s.isDirectory())
    .catch(() => false);

  if (!rootExists) {
    return result; // Tree doesn't exist - nothing to compact
  }

  try {
    await compactDirRecursive(treeRoot, result);
  } catch (err) {
    result.errors.push({
      path: treeRoot,
      error: `Failed to scan tree: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return result;
}

/**
 * Recursively compact a directory and its children.
 * Returns true if the directory was compacted (and should not be recursed into further).
 */
async function compactDirRecursive(dir: string, result: CompactionResult): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return false;
  }

  // Separate subdirectories from files
  const subdirs: string[] = [];
  const files = new Set(entries);

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    const isDir = await stat(entryPath)
      .then((s) => s.isDirectory())
      .catch(() => false);

    if (isDir) {
      subdirs.push(entry);
      files.delete(entry);
    }
  }

  // Check if this directory is a single-child wrapper
  // Single-child case: exactly one subdirectory and an index.md file
  if (subdirs.length === 1 && files.has("index.md")) {
    const childName = subdirs[0];
    const childPath = join(dir, childName);

    // Check if the child already has __parent* fields (already optimized)
    if (!(await isAlreadyOptimized(childPath))) {
      // Compact this directory
      try {
        await compactWrapper(dir, childName, result);
        result.compactedCount++;
        // Return true to indicate this directory was compacted
        // Don't recurse further - the child is now at the parent level
        return true;
      } catch (err) {
        result.errors.push({
          path: dir,
          error: `Failed to compact: ${err instanceof Error ? err.message : String(err)}`,
        });
        // Continue processing other directories on error
      }
    }
  }

  // Recurse into subdirectories (only if this directory wasn't compacted)
  for (const subdir of subdirs) {
    const subdirPath = join(dir, subdir);
    await compactDirRecursive(subdirPath, result);
  }

  return false;
}

/**
 * Check if a directory's item already has __parent* fields (is already optimized).
 * Returns true if any .md file in the directory contains __parent fields.
 */
async function isAlreadyOptimized(dir: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;

    try {
      const content = await readFile(join(dir, entry), "utf-8");
      // Check if frontmatter contains __parent fields
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        if (frontmatter.includes("__parent")) {
          return true;
        }
      }
    } catch {
      // Continue checking other files
    }
  }

  return false;
}

/**
 * Compact a single-child wrapper directory.
 *
 * 1. Extract parent metadata from wrapper's index.md
 * 2. Embed parent metadata into child's .md file(s)
 * 3. Move child directory to wrapper's parent directory
 * 4. Delete the wrapper directory
 */
async function compactWrapper(
  wrapperDir: string,
  childName: string,
  result: CompactionResult,
): Promise<void> {
  // Read parent metadata from wrapper's index.md
  const parentIndexPath = join(wrapperDir, "index.md");
  let parentContent: string;
  try {
    parentContent = await readFile(parentIndexPath, "utf-8");
  } catch {
    // No index.md found - skip this directory
    return;
  }

  // Extract frontmatter from parent's index.md
  const parentFrontmatter = extractFrontmatter(parentContent);
  if (!parentFrontmatter) {
    // No parent metadata found - might be malformed, skip
    return;
  }

  const childPath = join(wrapperDir, childName);

  // Get child's .md files
  let childEntries: string[];
  try {
    childEntries = await readdir(childPath);
  } catch {
    return;
  }

  // Embed parent metadata into each .md file in the child directory
  for (const entry of childEntries) {
    if (!entry.endsWith(".md")) continue;

    const childFilePath = join(childPath, entry);
    try {
      let childContent = await readFile(childFilePath, "utf-8");
      // Embed parent fields if not already present
      childContent = embedParentFieldsInMarkdown(childContent, parentFrontmatter);
      await writeFile(childFilePath, childContent, "utf-8");
    } catch (err) {
      result.errors.push({
        path: childFilePath,
        error: `Failed to embed parent metadata: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Move child directory to grandparent (wrapper's parent)
  const grandparentDir = wrapperDir.split("/").slice(0, -1).join("/");
  const newChildPath = join(grandparentDir, childName);

  try {
    // Move child to grandparent
    await rename(childPath, newChildPath);
  } catch (err) {
    result.errors.push({
      path: childPath,
      error: `Failed to move child directory: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // Delete the wrapper directory
  try {
    await rm(wrapperDir, { recursive: true, force: true });
  } catch (err) {
    result.errors.push({
      path: wrapperDir,
      error: `Failed to delete wrapper directory: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/**
 * Extract YAML frontmatter from a markdown file.
 * Returns the frontmatter block (excluding the --- delimiters) or null if not found.
 */
function extractFrontmatter(content: string): string | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

/**
 * Embed parent metadata fields into a child's markdown file.
 *
 * If the child already has __parent* fields, returns content unchanged (idempotent).
 * Otherwise, inserts __parent* fields from the parent into the child's frontmatter.
 *
 * Handles YAML arrays and nested structures by preserving their formatting.
 */
function embedParentFieldsInMarkdown(childContent: string, parentFrontmatter: string): string {
  // Check if already has __parent fields (idempotent)
  if (childContent.includes("__parent")) {
    return childContent;
  }

  // Find child's frontmatter
  const fmMatch = childContent.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    // No frontmatter - shouldn't happen, but return unchanged
    return childContent;
  }

  const childFm = fmMatch[1];
  const afterFm = childContent.substring(fmMatch.index! + fmMatch[0].length);

  // Parse parent frontmatter into lines, handling YAML arrays
  const parentLines = parseYamlLines(parentFrontmatter);

  // Add __parent prefix to each parent field, converting keys to camelCase
  const embeddedLines = parentLines.map((line) => {
    // For array items (lines starting with "  -"), prefix the parent key with __parent
    if (line.startsWith("  -")) {
      return line; // Keep array items as-is (they're part of their parent key)
    }

    // Parse "key: value" format and add __parent prefix with camelCase key
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      return `__parent${line}`;
    }

    const key = line.substring(0, colonIdx).trim();
    const rest = line.substring(colonIdx);
    const camelKey = toCamelCaseKey(key);
    return `__parent${camelKey}${rest}`;
  });

  // Insert embedded lines at the end of child's frontmatter (before the closing ---)
  const updatedFm = `${childFm}${childFm.endsWith("\n") ? "" : "\n"}${embeddedLines.join("\n")}\n`;
  const newContent = `---\n${updatedFm}---${afterFm}`;

  return newContent;
}

/**
 * Parse YAML lines from a frontmatter block.
 * Returns an array of lines, handling YAML arrays and nested structures.
 * Skips empty lines and comments.
 */
function parseYamlLines(frontmatter: string): string[] {
  return frontmatter
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("#");
    });
}

/**
 * Convert a YAML key name to its camelCase equivalent.
 * Maps lowercase keys like "id", "status" to "Id", "Status" for __parent prefixing.
 */
function toCamelCaseKey(yamlKey: string): string {
  if (yamlKey.length === 0) return yamlKey;
  // Capitalize first letter (id -> Id, status -> Status)
  return yamlKey.charAt(0).toUpperCase() + yamlKey.slice(1);
}
