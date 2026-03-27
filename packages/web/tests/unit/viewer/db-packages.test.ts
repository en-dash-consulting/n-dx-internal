import { describe, it, expect } from "vitest";
import {
  classifyDbPackage,
  detectDatabasePackages,
  DB_CATEGORY_LABELS,
  DB_CATEGORY_TAG_CLASS,
} from "../../../src/viewer/views/db-packages.js";
import type { DbCategory } from "../../../src/viewer/views/db-packages.js";
import type { ExternalImport } from "../../../src/schema/v1.js";

// ── classifyDbPackage ──────────────────────────────────────────────

describe("classifyDbPackage", () => {
  it("returns null for unknown packages", () => {
    expect(classifyDbPackage("react")).toBeNull();
    expect(classifyDbPackage("lodash")).toBeNull();
    expect(classifyDbPackage("express")).toBeNull();
  });

  // ── Exact matches ──

  it("classifies Node.js database drivers", () => {
    expect(classifyDbPackage("pg")).toBe("driver");
    expect(classifyDbPackage("mysql2")).toBe("driver");
    expect(classifyDbPackage("better-sqlite3")).toBe("driver");
    expect(classifyDbPackage("mongodb")).toBe("driver");
    expect(classifyDbPackage("tedious")).toBe("driver");
  });

  it("classifies ORMs", () => {
    expect(classifyDbPackage("prisma")).toBe("orm");
    expect(classifyDbPackage("@prisma/client")).toBe("orm");
    expect(classifyDbPackage("sequelize")).toBe("orm");
    expect(classifyDbPackage("typeorm")).toBe("orm");
    expect(classifyDbPackage("drizzle-orm")).toBe("orm");
    expect(classifyDbPackage("mongoose")).toBe("orm");
  });

  it("classifies query builders", () => {
    expect(classifyDbPackage("knex")).toBe("query-builder");
    expect(classifyDbPackage("kysely")).toBe("query-builder");
    expect(classifyDbPackage("slonik")).toBe("query-builder");
  });

  it("classifies migration tools", () => {
    expect(classifyDbPackage("db-migrate")).toBe("migration");
    expect(classifyDbPackage("node-pg-migrate")).toBe("migration");
    expect(classifyDbPackage("umzug")).toBe("migration");
  });

  it("classifies cache/KV stores", () => {
    expect(classifyDbPackage("redis")).toBe("cache");
    expect(classifyDbPackage("ioredis")).toBe("cache");
    expect(classifyDbPackage("@upstash/redis")).toBe("cache");
    expect(classifyDbPackage("memcached")).toBe("cache");
  });

  // ── Go packages ──

  it("classifies Go database packages", () => {
    expect(classifyDbPackage("database/sql")).toBe("driver");
    expect(classifyDbPackage("gorm.io/gorm")).toBe("orm");
    expect(classifyDbPackage("github.com/jmoiron/sqlx")).toBe("query-builder");
    expect(classifyDbPackage("github.com/go-redis/redis")).toBe("cache");
    expect(classifyDbPackage("github.com/golang-migrate/migrate")).toBe("migration");
  });

  // ── stdlib: prefix handling ──

  it("strips stdlib: prefix before matching", () => {
    expect(classifyDbPackage("stdlib:database/sql")).toBe("driver");
  });

  // ── Prefix matching for versioned paths ──

  it("matches versioned Go module paths via prefix", () => {
    expect(classifyDbPackage("github.com/jackc/pgx/v5")).toBe("driver");
    expect(classifyDbPackage("github.com/go-redis/redis/v9")).toBe("cache");
    expect(classifyDbPackage("github.com/golang-migrate/migrate/v4")).toBe("migration");
  });

  it("does not match unrelated packages with similar names", () => {
    // "pg-boss" should not match "pg" (no prefix match — different package)
    expect(classifyDbPackage("pg-boss")).toBeNull();
    // "redis-parser" should not match "redis"
    expect(classifyDbPackage("redis-parser")).toBeNull();
  });
});

// ── detectDatabasePackages ─────────────────────────────────────────

describe("detectDatabasePackages", () => {
  const makeExt = (pkg: string, importerCount: number, symbols: string[] = []): ExternalImport => ({
    package: pkg,
    importedBy: Array.from({ length: importerCount }, (_, i) => `file${i}.ts`),
    symbols,
  });

  it("returns empty array when no database packages found", () => {
    const externals = [makeExt("react", 10), makeExt("lodash", 5)];
    expect(detectDatabasePackages(externals)).toEqual([]);
  });

  it("detects database packages from mixed external imports", () => {
    const externals = [
      makeExt("react", 10),
      makeExt("pg", 3, ["Pool", "Client"]),
      makeExt("lodash", 5),
      makeExt("prisma", 7, ["PrismaClient"]),
    ];

    const result = detectDatabasePackages(externals);
    expect(result).toHaveLength(2);
    expect(result[0].ext.package).toBe("prisma"); // sorted by importedBy count
    expect(result[0].category).toBe("orm");
    expect(result[1].ext.package).toBe("pg");
    expect(result[1].category).toBe("driver");
  });

  it("sorts results by importer count descending", () => {
    const externals = [
      makeExt("redis", 2),
      makeExt("pg", 8),
      makeExt("knex", 5),
    ];

    const result = detectDatabasePackages(externals);
    expect(result.map((m) => m.ext.package)).toEqual(["pg", "knex", "redis"]);
  });

  it("classifies multiple categories", () => {
    const externals = [
      makeExt("pg", 5),
      makeExt("prisma", 3),
      makeExt("knex", 2),
      makeExt("db-migrate", 1),
      makeExt("redis", 4),
    ];

    const result = detectDatabasePackages(externals);
    expect(result).toHaveLength(5);

    const categories = new Set(result.map((m) => m.category));
    expect(categories).toEqual(new Set(["driver", "orm", "query-builder", "migration", "cache"]));
  });

  it("handles empty input", () => {
    expect(detectDatabasePackages([])).toEqual([]);
  });
});

// ── Label & tag-class maps ─────────────────────────────────────────

describe("DB_CATEGORY_LABELS", () => {
  it("has a label for every category", () => {
    const categories: DbCategory[] = ["driver", "orm", "query-builder", "migration", "cache"];
    for (const cat of categories) {
      expect(DB_CATEGORY_LABELS[cat]).toBeTruthy();
    }
  });
});

describe("DB_CATEGORY_TAG_CLASS", () => {
  it("has a tag class for every category", () => {
    const categories: DbCategory[] = ["driver", "orm", "query-builder", "migration", "cache"];
    for (const cat of categories) {
      expect(DB_CATEGORY_TAG_CLASS[cat]).toMatch(/^tag-/);
    }
  });

  it("uses only existing CSS tag classes", () => {
    const knownClasses = ["tag-source", "tag-test", "tag-config", "tag-docs", "tag-other"];
    for (const cls of Object.values(DB_CATEGORY_TAG_CLASS)) {
      expect(knownClasses).toContain(cls);
    }
  });
});
