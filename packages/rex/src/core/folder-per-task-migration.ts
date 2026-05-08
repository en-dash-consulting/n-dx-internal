/**
 * Structural migration pass for folder-per-task conformance.
 *
 * The folder-per-task schema requires:
 * 1. Each task (and lower levels) should live in its own directory
 * 2. The directory should contain a title-named .md file (e.g., task_title.md)
 * 3. Subtasks with children must be in a folder, not a bare .md file
 *
 * This pass scans the PRD tree and detects non-conforming structures:
 * - Bare .md files at the task level (should be in a folder)
 * - Subtask .md files that have orphaned child siblings (should be in a folder)
 *
 * The migration is idempotent: running it twice on a conforming tree produces
 * zero changes.
 *
 * @module core/folder-per-task-migration
 */

import { readdir, readFile, writeFile, rm, rename, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, type ParseWarning } from "../store/folder-tree-parser.js";
import { titleToFilename } from "../store/title-to-filename.js";

/**
 * Result of running the folder-per-task structural migration.
 */
export interface FolderPerTaskMigrationResult {
  /** Number of files that were migrated. */
  migratedCount: number;
  /** Details of each migration. */
  migrations: Array<{
    path: string;
    type: "bare-task-to-folder" | "subtask-with-children-to-folder";
    beforePath: string;
    afterPath: string;
  }>;
  /** Errors encountered during migration. */
  errors: Array<{ path: string; error: string }>;
}

/**
 * Scan the folder tree and detect/migrate non-conforming task-level structures.
 * Returns a summary of what was migrated.
 */
export async function migrateToFolderPerTask(
  treeRoot: string,
): Promise<FolderPerTaskMigrationResult> {
  const result: FolderPerTaskMigrationResult = {
    migratedCount: 0,
    migrations: [],
    errors: [],
  };

  const rootExists = await stat(treeRoot)
    .then((s) => s.isDirectory())
    .catch(() => false);

  if (!rootExists) {
    return result; // Tree doesn't exist - nothing to migrate
  }

  try {
    await migrateDirRecursive(treeRoot, "epic", result);
  } catch (err) {
    result.errors.push({
      path: treeRoot,
      error: `Failed to scan tree: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return result;
}

/**
 * Recursively scan and migrate a directory and its children.
 * currentLevel is the level of items we expect to find AT this directory.
 * For example, if currentLevel="feature", we're inside a feature directory.
 */
async function migrateDirRecursive(
  dir: string,
  currentLevel: "epic" | "feature" | "task" | "subtask",
  result: FolderPerTaskMigrationResult,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  // Categorize entries
  const subdirs: string[] = [];
  const mdFiles: string[] = [];

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    const isDir = await stat(entryPath)
      .then((s) => s.isDirectory())
      .catch(() => false);

    if (isDir) {
      subdirs.push(entry);
    } else if (entry.endsWith(".md") && !entry.startsWith(".")) {
      mdFiles.push(entry);
    }
  }

  // The child level is what we expect to find in subdirectories
  const childLevel = currentLevel === "epic"
    ? "feature"
    : currentLevel === "feature"
      ? "task"
      : currentLevel === "task"
        ? "subtask"
        : "subtask" as const;

  // Detect and migrate non-conforming files:
  // - Subtask .md files with children (check this FIRST)
  // - Bare task/subtask .md files at the wrong level
  for (const mdFile of mdFiles) {
    const itemLevel = await readItemLevel(join(dir, mdFile));

    // Check for subtask .md files with children BEFORE bare file migration
    if (itemLevel === "subtask" && currentLevel === "task") {
      // At task level, check for subtask .md files with children
      const hasChildren = await hasChildrenSiblings(dir, mdFile);
      if (hasChildren) {
        try {
          await migrateSubtaskWithChildrenToFolder(dir, mdFile, result);
          result.migratedCount++;
        } catch (err) {
          result.errors.push({
            path: join(dir, mdFile),
            error: `Failed to migrate: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        // Skip further processing for this file since we handled the children
        continue;
      }
      // If no children, fall through to bare file migration below
    }

    // Check if this file is a child-level item (should be in a folder, not bare)
    // BUT: if we're already inside an item's own folder (not at top level), this is OK
    // Only migrate files that are at the wrong nesting level
    if (itemLevel === childLevel && currentLevel !== childLevel) {
      try {
        await migrateBareFileToFolder(dir, mdFile, result);
        result.migratedCount++;
      } catch (err) {
        result.errors.push({
          path: join(dir, mdFile),
          error: `Failed to migrate: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // Recurse into subdirectories
  for (const subdir of subdirs) {
    const subdirPath = join(dir, subdir);
    // The next level is one level deeper
    const nextLevel = childLevel;
    await migrateDirRecursive(subdirPath, nextLevel, result);
  }
}

/**
 * Read the `level` field from an item's markdown file frontmatter.
 * Returns null when the file is missing, malformed, or has no level field.
 */
async function readItemLevel(mdPath: string): Promise<string | null> {
  try {
    const content = await readFile(mdPath, "utf-8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const levelMatch = fmMatch[1].match(/^level:\s*"?([^"\n]+)"?/m);
    return levelMatch ? levelMatch[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Check if a directory has child siblings (slug-prefixed directories) for a
 * given subtask .md file. This indicates orphaned children.
 */
async function hasChildrenSiblings(dir: string, mdFile: string): Promise<boolean> {
  // Extract the base name from the .md file
  const baseName = mdFile.replace(/\.md$/, "");

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return false;
  }

  // Look for directories that start with the base name (likely children)
  for (const entry of entries) {
    if (entry.startsWith(baseName + "-") && !entry.endsWith(".md")) {
      const entryPath = join(dir, entry);
      const isDir = await stat(entryPath)
        .then((s) => s.isDirectory())
        .catch(() => false);
      if (isDir) {
        return true; // Found a child directory
      }
    }
  }

  return false;
}

/**
 * Migrate a bare task/subtask .md file to a folder structure.
 *
 * 1. Create a new folder with the task's slug
 * 2. Move the .md file into the folder
 * 3. Optionally rename it to index.md (or keep the title-based name)
 *
 * For now, we'll create a folder with a slug and move the file as index.md.
 */
async function migrateBareFileToFolder(
  dir: string,
  mdFile: string,
  result: FolderPerTaskMigrationResult,
): Promise<void> {
  const mdPath = join(dir, mdFile);

  // Read the file to get the ID and title for slug generation
  const content = await readFile(mdPath, "utf-8");
  const parseWarnings: ParseWarning[] = [];
  const fm = parseFrontmatter(content, mdPath, parseWarnings);

  if (!fm || !fm.id || !fm.title) {
    throw new Error(`Invalid frontmatter: missing id or title`);
  }

  // Generate a slug based on the item's ID and title
  const slug = `${mdFile.replace(/\.md$/, "")}-${String(fm.id).slice(0, 6)}`;
  const folderPath = join(dir, slug);

  // Create the folder
  await mkdir(folderPath, { recursive: true });

  // Move the .md file to the folder as index.md (or as the title-based name)
  const newMdPath = join(folderPath, "index.md");
  await rename(mdPath, newMdPath);

  result.migrations.push({
    path: mdPath,
    type: "bare-task-to-folder",
    beforePath: mdPath,
    afterPath: newMdPath,
  });
}

/**
 * Migrate a subtask .md file with children to a folder structure.
 *
 * 1. Create a new folder for the subtask
 * 2. Move the .md file to the folder
 * 3. Move any child directories into the folder
 */
async function migrateSubtaskWithChildrenToFolder(
  dir: string,
  mdFile: string,
  result: FolderPerTaskMigrationResult,
): Promise<void> {
  const mdPath = join(dir, mdFile);
  const baseName = mdFile.replace(/\.md$/, "");

  // Read the file to get the ID for slug generation
  const content = await readFile(mdPath, "utf-8");
  const parseWarnings: ParseWarning[] = [];
  const fm = parseFrontmatter(content, mdPath, parseWarnings);

  if (!fm || !fm.id) {
    throw new Error(`Invalid frontmatter: missing id`);
  }

  // Generate a slug
  const slug = `${baseName}-${String(fm.id).slice(0, 6)}`;
  const folderPath = join(dir, slug);

  // Create the folder
  await mkdir(folderPath, { recursive: true });

  // Move the .md file to the folder
  const newMdPath = join(folderPath, "index.md");
  await rename(mdPath, newMdPath);

  // Move child directories to the folder
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === slug) continue; // Skip the folder we just created
    if (entry.startsWith(baseName + "-") && !entry.endsWith(".md")) {
      const entryPath = join(dir, entry);
      const isDir = await stat(entryPath)
        .then((s) => s.isDirectory())
        .catch(() => false);
      if (isDir) {
        // Move this child to the subtask folder
        const newChildPath = join(folderPath, entry);
        await rename(entryPath, newChildPath);
      }
    }
  }

  result.migrations.push({
    path: mdPath,
    type: "subtask-with-children-to-folder",
    beforePath: mdPath,
    afterPath: newMdPath,
  });
}
