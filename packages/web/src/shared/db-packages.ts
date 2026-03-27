/**
 * Database package detection — framework-agnostic classification logic.
 *
 * Provides a curated registry of known database-related packages and
 * classification logic. The registry covers common ecosystems (Node.js,
 * Go, Python) and categorises packages into driver, ORM, query-builder,
 * migration, and cache/kv buckets.
 *
 * This module lives in shared/ because both the server (API endpoint)
 * and viewer (Architecture panel) consume it. It satisfies the
 * two-consumer rule documented in CLAUDE.md § web-shared addition policy.
 */

import type { ExternalImport } from "../schema/v1.js";

// ── Category taxonomy ──────────────────────────────────────────────

export type DbCategory = "driver" | "orm" | "query-builder" | "migration" | "cache";

export interface DbPackageMatch {
  /** The external import that matched */
  ext: ExternalImport;
  /** Classification category */
  category: DbCategory;
}

/** Aggregate statistics per category. */
export interface DbCategorySummary {
  category: DbCategory;
  label: string;
  packageCount: number;
  totalImporters: number;
  packages: Array<{ name: string; importerCount: number }>;
}

/** Full response shape for the /api/sv/db-packages endpoint. */
export interface DbPackagesResponse {
  /** All matched database packages, sorted by usage descending. */
  matches: Array<{
    package: string;
    category: DbCategory;
    importedBy: string[];
    symbols: string[];
  }>;
  /** Per-category breakdown. */
  categories: DbCategorySummary[];
  /** Total number of database packages detected. */
  totalPackages: number;
  /** Total number of unique files that import at least one database package. */
  totalImporters: number;
}

// ── Known database packages ────────────────────────────────────────

/** Map of package name (or prefix) → category. */
const KNOWN_DB_PACKAGES: ReadonlyMap<string, DbCategory> = new Map([
  // ── Node.js / TypeScript drivers ──
  ["pg", "driver"],
  ["pg-pool", "driver"],
  ["pg-cursor", "driver"],
  ["pg-native", "driver"],
  ["mysql", "driver"],
  ["mysql2", "driver"],
  ["better-sqlite3", "driver"],
  ["sqlite3", "driver"],
  ["mongodb", "driver"],
  ["tedious", "driver"],        // SQL Server
  ["mssql", "driver"],          // SQL Server (wrapper)
  ["oracledb", "driver"],
  ["cassandra-driver", "driver"],
  ["neo4j-driver", "driver"],
  ["@neondatabase/serverless", "driver"],
  ["@planetscale/database", "driver"],
  ["@libsql/client", "driver"],
  ["duckdb", "driver"],
  ["duckdb-async", "driver"],
  ["@clickhouse/client", "driver"],
  ["@surrealdb/node", "driver"],
  ["surrealdb.js", "driver"],
  ["couchbase", "driver"],
  ["nano", "driver"],           // CouchDB
  ["arangojs", "driver"],       // ArangoDB
  ["rethinkdb", "driver"],
  ["@elastic/elasticsearch", "driver"],
  ["@opensearch-project/opensearch", "driver"],

  // ── Node.js / TypeScript cloud database drivers ──
  ["@aws-sdk/client-dynamodb", "driver"],
  ["@aws-sdk/lib-dynamodb", "driver"],
  ["@azure/cosmos", "driver"],
  ["@google-cloud/datastore", "driver"],
  ["@google-cloud/firestore", "driver"],
  ["@google-cloud/bigtable", "driver"],
  ["@google-cloud/spanner", "driver"],
  ["firebase-admin/firestore", "driver"],
  ["fauna", "driver"],
  ["faunadb", "driver"],

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
  ["sql-template-strings", "query-builder"],
  ["sql-template-tag", "query-builder"],

  // ── Node.js migration tools ──
  ["db-migrate", "migration"],
  ["node-pg-migrate", "migration"],
  ["umzug", "migration"],
  ["@prisma/migrate", "migration"],
  ["drizzle-kit", "migration"],

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
  ["@upstash/ratelimit", "cache"],
  ["catbox", "cache"],          // hapi cache framework
  ["catbox-redis", "cache"],
  ["catbox-memory", "cache"],

  // ── Go drivers (detected via stdlib-style paths) ──
  ["database/sql", "driver"],
  ["github.com/lib/pq", "driver"],
  ["github.com/jackc/pgx", "driver"],
  ["github.com/go-sql-driver/mysql", "driver"],
  ["github.com/mattn/go-sqlite3", "driver"],
  ["go.mongodb.org/mongo-driver", "driver"],
  ["github.com/gocql/gocql", "driver"],          // Cassandra
  ["github.com/elastic/go-elasticsearch", "driver"],
  ["github.com/olivere/elastic", "driver"],       // Elasticsearch (legacy)
  ["github.com/neo4j/neo4j-go-driver", "driver"],
  ["github.com/marcboeker/go-duckdb", "driver"],

  // ── Go ORMs ──
  ["gorm.io/gorm", "orm"],
  ["github.com/go-gorm/gorm", "orm"],
  ["entgo.io/ent", "orm"],
  ["github.com/volatiletech/sqlboiler", "orm"],
  ["github.com/uptrace/bun", "orm"],

  // ── Go query builders ──
  ["github.com/Masterminds/squirrel", "query-builder"],
  ["github.com/jmoiron/sqlx", "query-builder"],
  ["github.com/doug-martin/goqu", "query-builder"],

  // ── Go cache ──
  ["github.com/go-redis/redis", "cache"],
  ["github.com/redis/go-redis", "cache"],
  ["github.com/bradfitz/gomemcache", "cache"],
  ["github.com/dgraph-io/badger", "cache"],

  // ── Go migrations ──
  ["github.com/golang-migrate/migrate", "migration"],
  ["github.com/pressly/goose", "migration"],
  ["github.com/rubenv/sql-migrate", "migration"],

  // ── Python (shown as package names in external imports) ──
  ["sqlalchemy", "orm"],
  ["django.db", "orm"],
  ["peewee", "orm"],
  ["tortoise-orm", "orm"],
  ["databases", "driver"],      // encode/databases async wrapper
  ["psycopg2", "driver"],
  ["psycopg", "driver"],
  ["pymongo", "driver"],
  ["motor", "driver"],          // async MongoDB
  ["asyncpg", "driver"],
  ["aiomysql", "driver"],
  ["aiosqlite", "driver"],
  ["redis-py", "cache"],
  ["aioredis", "cache"],
  ["alembic", "migration"],
]);

// ── Human-readable labels ──────────────────────────────────────────

/** Human-readable labels for each category. */
export const DB_CATEGORY_LABELS: Readonly<Record<DbCategory, string>> = {
  driver: "Driver",
  orm: "ORM",
  "query-builder": "Query Builder",
  migration: "Migration",
  cache: "Cache / KV",
};

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

/**
 * Build a structured API response from detected database packages.
 *
 * This produces the full response shape served by GET /api/sv/db-packages,
 * aggregating matches into per-category summaries with importer counts.
 */
export function buildDbPackagesResponse(externals: ExternalImport[]): DbPackagesResponse {
  const matches = detectDatabasePackages(externals);

  // Build per-category summaries
  const categoryMap = new Map<DbCategory, { packages: Array<{ name: string; importerCount: number }>; totalImporters: Set<string> }>();

  for (const m of matches) {
    let entry = categoryMap.get(m.category);
    if (!entry) {
      entry = { packages: [], totalImporters: new Set() };
      categoryMap.set(m.category, entry);
    }
    entry.packages.push({
      name: m.ext.package,
      importerCount: m.ext.importedBy.length,
    });
    for (const file of m.ext.importedBy) {
      entry.totalImporters.add(file);
    }
  }

  // Compute global unique importers
  const allImporters = new Set<string>();
  for (const m of matches) {
    for (const file of m.ext.importedBy) {
      allImporters.add(file);
    }
  }

  // Build ordered category list (by total importers descending)
  const categoryOrder: DbCategory[] = ["driver", "orm", "query-builder", "migration", "cache"];
  const categories: DbCategorySummary[] = categoryOrder
    .filter((cat) => categoryMap.has(cat))
    .map((cat) => {
      const entry = categoryMap.get(cat)!;
      return {
        category: cat,
        label: DB_CATEGORY_LABELS[cat],
        packageCount: entry.packages.length,
        totalImporters: entry.totalImporters.size,
        packages: entry.packages,
      };
    });

  return {
    matches: matches.map((m) => ({
      package: m.ext.package,
      category: m.category,
      importedBy: m.ext.importedBy,
      symbols: m.ext.symbols,
    })),
    categories,
    totalPackages: matches.length,
    totalImporters: allImporters.size,
  };
}
