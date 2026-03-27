/**
 * Database package detection for the Architecture view.
 *
 * Re-exports the shared detection logic from web-shared and adds
 * viewer-specific constants (CSS tag classes) for rendering.
 *
 * The core classification registry and detection functions live in
 * `src/shared/db-packages.ts` so the server can also serve them
 * via GET /api/sv/db-packages without crossing the viewer boundary.
 */

// Re-export shared detection logic through the external gateway
export {
  classifyDbPackage,
  detectDatabasePackages,
  DB_CATEGORY_LABELS,
} from "../external.js";
export type {
  DbCategory,
  DbPackageMatch,
} from "../external.js";

// ── Viewer-only constants ──────────────────────────────────────────

/** CSS tag class for each category (reuses existing tag classes from tables.css). */
export const DB_CATEGORY_TAG_CLASS: Readonly<Record<import("../external.js").DbCategory, string>> = {
  driver: "tag-source",
  orm: "tag-docs",
  "query-builder": "tag-config",
  migration: "tag-other",
  cache: "tag-test",
};
