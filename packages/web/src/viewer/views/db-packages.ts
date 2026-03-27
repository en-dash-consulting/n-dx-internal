/**
 * Database package detection for the Architecture view.
 *
 * Provides a curated registry of known database-related packages and
 * classification logic used by the Database Layer panel. The registry
 * covers common ecosystems (Node.js, Go, Python) and categorises
 * packages into driver, ORM, query-builder, migration, and cache/kv
 * buckets so the panel can render a meaningful breakdown.
 *
 * When the sibling "database package detection analyzer" task lands in
 * sourcevision, this client-side heuristic can be replaced or augmented
 * by server-provided classifications.
 */

import type { ExternalImport } from "../external.js";

// ── Category taxonomy ──────────────────────────────────────────────

export type DbCategory = "driver" | "orm" | "query-builder" | "migration" | "cache";

export interface DbPackageMatch {
  /** The external import that matched */
  ext: ExternalImport;
  /** Classification category */
  category: DbCategory;
}

// ── Known database packages ────────────────────────────────────────

/** Map of package name (or prefix) → category. */
const KNOWN_DB_PACKAGES: ReadonlyMap<string, DbCategory> = new Map([
  // ── Node.js / TypeScript drivers ──
  ["pg", "driver"],
  ["pg-pool", "driver"],
  ["pg-cursor", "driver"],
  ["mysql", "driver"],
  ["mysql2", "driver"],
  ["better-sqlite3", "driver"],
  ["sqlite3", "driver"],
  ["mongodb", "driver"],
  ["tedious", "driver"],        // SQL Server
  ["oracledb", "driver"],
  ["cassandra-driver", "driver"],
  ["neo4j-driver", "driver"],
  ["@neondatabase/serverless", "driver"],
  ["@planetscale/database", "driver"],
  ["@libsql/client", "driver"],

  // ── Node.js / TypeScript ORMs ──
  ["prisma", "orm"],
  ["@prisma/client", "orm"],
  ["sequelize", "orm"],
  ["typeorm", "orm"],
  ["drizzle-orm", "orm"],
  ["mongoose", "orm"],
  ["mikro-orm", "orm"],
  ["@mikro-orm/core", "orm"],
  ["objection", "orm"],
  ["bookshelf", "orm"],
  ["waterline", "orm"],

  // ── Node.js query builders ──
  ["knex", "query-builder"],
  ["kysely", "query-builder"],
  ["slonik", "query-builder"],
  ["@electric-sql/pglite", "query-builder"],

  // ── Node.js migration tools ──
  ["db-migrate", "migration"],
  ["node-pg-migrate", "migration"],
  ["umzug", "migration"],

  // ── Cache / KV stores ──
  ["redis", "cache"],
  ["ioredis", "cache"],
  ["@upstash/redis", "cache"],
  ["memcached", "cache"],
  ["keyv", "cache"],
  ["lmdb", "cache"],
  ["level", "cache"],
  ["leveldown", "cache"],
  ["levelup", "cache"],

  // ── Go drivers (detected via stdlib-style paths) ──
  ["database/sql", "driver"],
  ["github.com/lib/pq", "driver"],
  ["github.com/jackc/pgx", "driver"],
  ["github.com/go-sql-driver/mysql", "driver"],
  ["github.com/mattn/go-sqlite3", "driver"],
  ["go.mongodb.org/mongo-driver", "driver"],

  // ── Go ORMs ──
  ["gorm.io/gorm", "orm"],
  ["github.com/go-gorm/gorm", "orm"],
  ["entgo.io/ent", "orm"],
  ["github.com/volatiletech/sqlboiler", "orm"],

  // ── Go query builders ──
  ["github.com/Masterminds/squirrel", "query-builder"],
  ["github.com/jmoiron/sqlx", "query-builder"],

  // ── Go cache ──
  ["github.com/go-redis/redis", "cache"],
  ["github.com/redis/go-redis", "cache"],

  // ── Go migrations ──
  ["github.com/golang-migrate/migrate", "migration"],
  ["github.com/pressly/goose", "migration"],

  // ── Python (shown as package names in external imports) ──
  ["sqlalchemy", "orm"],
  ["django.db", "orm"],
  ["peewee", "orm"],
  ["tortoise-orm", "orm"],
  ["psycopg2", "driver"],
  ["psycopg", "driver"],
  ["pymongo", "driver"],
  ["asyncpg", "driver"],
  ["aiomysql", "driver"],
  ["alembic", "migration"],
]);

// ── Detection logic ────────────────────────────────────────────────

/**
 * Match an external import package name against the known database registry.
 *
 * Uses exact match first, then falls back to prefix matching for scoped
 * packages and Go module paths (e.g. `github.com/jackc/pgx/v5` matches
 * `github.com/jackc/pgx`).
 */
export function classifyDbPackage(packageName: string): DbCategory | null {
  // Exact match (covers most cases)
  const exact = KNOWN_DB_PACKAGES.get(packageName);
  if (exact) return exact;

  // Strip stdlib: prefix for Go standard library imports
  const cleaned = packageName.startsWith("stdlib:") ? packageName.slice(7) : packageName;
  if (cleaned !== packageName) {
    const stdlibMatch = KNOWN_DB_PACKAGES.get(cleaned);
    if (stdlibMatch) return stdlibMatch;
  }

  // Prefix matching for versioned Go paths and scoped packages
  for (const [known, category] of KNOWN_DB_PACKAGES) {
    if (cleaned.startsWith(known + "/") || cleaned.startsWith(known + "@")) {
      return category;
    }
  }

  return null;
}

/**
 * Filter and classify database packages from a list of external imports.
 * Returns matches sorted by usage (importedBy count) descending.
 */
export function detectDatabasePackages(externals: ExternalImport[]): DbPackageMatch[] {
  const matches: DbPackageMatch[] = [];

  for (const ext of externals) {
    const category = classifyDbPackage(ext.package);
    if (category) {
      matches.push({ ext, category });
    }
  }

  // Sort by usage descending
  matches.sort((a, b) => b.ext.importedBy.length - a.ext.importedBy.length);

  return matches;
}

/** Human-readable labels for each category. */
export const DB_CATEGORY_LABELS: Readonly<Record<DbCategory, string>> = {
  driver: "Driver",
  orm: "ORM",
  "query-builder": "Query Builder",
  migration: "Migration",
  cache: "Cache / KV",
};

/** CSS tag class for each category (reuses existing tag classes from tables.css). */
export const DB_CATEGORY_TAG_CLASS: Readonly<Record<DbCategory, string>> = {
  driver: "tag-source",
  orm: "tag-docs",
  "query-builder": "tag-config",
  migration: "tag-other",
  cache: "tag-test",
};
