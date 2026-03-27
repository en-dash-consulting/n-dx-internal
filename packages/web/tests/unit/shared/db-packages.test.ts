import { describe, it, expect } from "vitest";
import {
  classifyDbPackage,
  detectDatabasePackages,
  buildDbPackagesResponse,
  DB_CATEGORY_LABELS,
} from "../../../src/shared/db-packages.js";
import type { DbCategory } from "../../../src/shared/db-packages.js";
import type { ExternalImport } from "../../../src/schema/v1.js";

// ── Helper ─────────────────────────────────────────────────────────

const makeExt = (pkg: string, importerCount: number, symbols: string[] = []): ExternalImport => ({
  package: pkg,
  importedBy: Array.from({ length: importerCount }, (_, i) => `file${i}.ts`),
  symbols,
});

// ── classifyDbPackage (shared) ─────────────────────────────────────

describe("classifyDbPackage (shared)", () => {
  it("returns null for unknown packages", () => {
    expect(classifyDbPackage("react")).toBeNull();
    expect(classifyDbPackage("express")).toBeNull();
    expect(classifyDbPackage("lodash")).toBeNull();
    expect(classifyDbPackage("@types/node")).toBeNull();
  });

  it("classifies known database packages", () => {
    expect(classifyDbPackage("pg")).toBe("driver");
    expect(classifyDbPackage("prisma")).toBe("orm");
    expect(classifyDbPackage("knex")).toBe("query-builder");
    expect(classifyDbPackage("db-migrate")).toBe("migration");
    expect(classifyDbPackage("redis")).toBe("cache");
  });

  it("handles stdlib: prefix", () => {
    expect(classifyDbPackage("stdlib:database/sql")).toBe("driver");
  });

  it("handles versioned Go paths", () => {
    expect(classifyDbPackage("github.com/jackc/pgx/v5")).toBe("driver");
    expect(classifyDbPackage("github.com/go-redis/redis/v9")).toBe("cache");
    expect(classifyDbPackage("github.com/golang-migrate/migrate/v4")).toBe("migration");
  });

  // ── Cloud database drivers ──

  it("classifies AWS database drivers", () => {
    expect(classifyDbPackage("@aws-sdk/client-dynamodb")).toBe("driver");
    expect(classifyDbPackage("@aws-sdk/lib-dynamodb")).toBe("driver");
  });

  it("classifies Azure database drivers", () => {
    expect(classifyDbPackage("@azure/cosmos")).toBe("driver");
  });

  it("classifies Google Cloud database drivers", () => {
    expect(classifyDbPackage("@google-cloud/datastore")).toBe("driver");
    expect(classifyDbPackage("@google-cloud/firestore")).toBe("driver");
    expect(classifyDbPackage("@google-cloud/bigtable")).toBe("driver");
    expect(classifyDbPackage("@google-cloud/spanner")).toBe("driver");
  });

  it("classifies FaunaDB drivers", () => {
    expect(classifyDbPackage("fauna")).toBe("driver");
    expect(classifyDbPackage("faunadb")).toBe("driver");
  });

  // ── Modern / specialty databases ──

  it("classifies modern database drivers", () => {
    expect(classifyDbPackage("duckdb")).toBe("driver");
    expect(classifyDbPackage("duckdb-async")).toBe("driver");
    expect(classifyDbPackage("@clickhouse/client")).toBe("driver");
    expect(classifyDbPackage("@surrealdb/node")).toBe("driver");
    expect(classifyDbPackage("surrealdb.js")).toBe("driver");
  });

  it("classifies NoSQL / document database drivers", () => {
    expect(classifyDbPackage("couchbase")).toBe("driver");
    expect(classifyDbPackage("nano")).toBe("driver");       // CouchDB
    expect(classifyDbPackage("arangojs")).toBe("driver");   // ArangoDB
    expect(classifyDbPackage("rethinkdb")).toBe("driver");
  });

  it("classifies search engine drivers", () => {
    expect(classifyDbPackage("@elastic/elasticsearch")).toBe("driver");
    expect(classifyDbPackage("@opensearch-project/opensearch")).toBe("driver");
  });

  // ── Additional Node.js packages ──

  it("classifies SQL Server packages", () => {
    expect(classifyDbPackage("mssql")).toBe("driver");
    expect(classifyDbPackage("tedious")).toBe("driver");
  });

  it("classifies additional query builders", () => {
    expect(classifyDbPackage("sql-template-strings")).toBe("query-builder");
    expect(classifyDbPackage("sql-template-tag")).toBe("query-builder");
  });

  it("classifies additional migration tools", () => {
    expect(classifyDbPackage("@prisma/migrate")).toBe("migration");
    expect(classifyDbPackage("drizzle-kit")).toBe("migration");
  });

  it("classifies additional cache packages", () => {
    expect(classifyDbPackage("@upstash/ratelimit")).toBe("cache");
    expect(classifyDbPackage("catbox")).toBe("cache");
    expect(classifyDbPackage("catbox-redis")).toBe("cache");
  });

  // ── Go packages ──

  it("classifies additional Go drivers", () => {
    expect(classifyDbPackage("github.com/gocql/gocql")).toBe("driver");
    expect(classifyDbPackage("github.com/elastic/go-elasticsearch")).toBe("driver");
    expect(classifyDbPackage("github.com/neo4j/neo4j-go-driver")).toBe("driver");
    expect(classifyDbPackage("github.com/marcboeker/go-duckdb")).toBe("driver");
  });

  it("classifies additional Go ORMs", () => {
    expect(classifyDbPackage("github.com/uptrace/bun")).toBe("orm");
  });

  it("classifies additional Go query builders", () => {
    expect(classifyDbPackage("github.com/doug-martin/goqu")).toBe("query-builder");
  });

  it("classifies additional Go cache stores", () => {
    expect(classifyDbPackage("github.com/bradfitz/gomemcache")).toBe("cache");
    expect(classifyDbPackage("github.com/dgraph-io/badger")).toBe("cache");
  });

  it("classifies additional Go migration tools", () => {
    expect(classifyDbPackage("github.com/rubenv/sql-migrate")).toBe("migration");
  });

  // ── Python packages ──

  it("classifies additional Python drivers", () => {
    expect(classifyDbPackage("motor")).toBe("driver");
    expect(classifyDbPackage("aiosqlite")).toBe("driver");
    expect(classifyDbPackage("databases")).toBe("driver");
  });

  it("classifies Python cache packages", () => {
    expect(classifyDbPackage("redis-py")).toBe("cache");
    expect(classifyDbPackage("aioredis")).toBe("cache");
  });

  // ── Negative cases (should NOT match) ──

  it("does not match unrelated packages with similar names", () => {
    expect(classifyDbPackage("pg-boss")).toBeNull();
    expect(classifyDbPackage("redis-parser")).toBeNull();
    expect(classifyDbPackage("mongoose-autopopulate")).toBeNull();
  });

  it("does not false-positive on partial name overlaps", () => {
    // "level" is a cache entry but "levelheaded" should not match
    expect(classifyDbPackage("levelheaded")).toBeNull();
    // "fauna" is a driver entry but "fauna-shell" should not match
    expect(classifyDbPackage("fauna-shell")).toBeNull();
  });
});

// ── detectDatabasePackages (shared) ────────────────────────────────

describe("detectDatabasePackages (shared)", () => {
  it("returns matches sorted by usage descending", () => {
    const externals = [makeExt("redis", 2), makeExt("pg", 8), makeExt("knex", 5)];
    const result = detectDatabasePackages(externals);
    expect(result.map((m) => m.ext.package)).toEqual(["pg", "knex", "redis"]);
  });

  it("returns empty array for no matches", () => {
    expect(detectDatabasePackages([makeExt("react", 10)])).toEqual([]);
  });

  it("filters and classifies mixed cloud and traditional packages", () => {
    const externals = [
      makeExt("@aws-sdk/client-dynamodb", 4),
      makeExt("@aws-sdk/client-s3", 6),     // not a DB package
      makeExt("pg", 3),
      makeExt("express", 10),
    ];
    const result = detectDatabasePackages(externals);
    expect(result).toHaveLength(2);
    expect(result[0].ext.package).toBe("@aws-sdk/client-dynamodb");
    expect(result[0].category).toBe("driver");
    expect(result[1].ext.package).toBe("pg");
    expect(result[1].category).toBe("driver");
  });

  it("handles Go module paths with version suffixes", () => {
    const externals = [
      makeExt("github.com/jackc/pgx/v5", 5),
      makeExt("github.com/go-redis/redis/v9", 3),
    ];
    const result = detectDatabasePackages(externals);
    expect(result).toHaveLength(2);
    expect(result[0].category).toBe("driver");
    expect(result[1].category).toBe("cache");
  });
});

// ── buildDbPackagesResponse ────────────────────────────────────────

describe("buildDbPackagesResponse", () => {
  it("builds a structured response with matches and categories", () => {
    const externals = [
      makeExt("react", 10),
      makeExt("pg", 3, ["Pool", "Client"]),
      makeExt("prisma", 5, ["PrismaClient"]),
      makeExt("knex", 2, ["knex"]),
      makeExt("redis", 4, ["createClient"]),
      makeExt("lodash", 7),
    ];

    const response = buildDbPackagesResponse(externals);

    // Match count (skips react and lodash)
    expect(response.totalPackages).toBe(4);
    expect(response.matches).toHaveLength(4);

    // Sorted by importedBy count: prisma(5) > redis(4) > pg(3) > knex(2)
    expect(response.matches[0].package).toBe("prisma");
    expect(response.matches[0].category).toBe("orm");
    expect(response.matches[1].package).toBe("redis");
    expect(response.matches[1].category).toBe("cache");

    // Categories present: driver, orm, query-builder, cache
    expect(response.categories).toHaveLength(4);
    const categoryNames = response.categories.map((c) => c.category);
    expect(categoryNames).toContain("driver");
    expect(categoryNames).toContain("orm");
    expect(categoryNames).toContain("query-builder");
    expect(categoryNames).toContain("cache");

    // Driver category details
    const driver = response.categories.find((c) => c.category === "driver")!;
    expect(driver.label).toBe("Driver");
    expect(driver.packageCount).toBe(1);
    expect(driver.packages[0].name).toBe("pg");
    expect(driver.packages[0].importerCount).toBe(3);
  });

  it("computes total unique importers correctly", () => {
    // pg imported by file0, file1 — prisma imported by file0, file2
    const externals: ExternalImport[] = [
      { package: "pg", importedBy: ["file0.ts", "file1.ts"], symbols: [] },
      { package: "prisma", importedBy: ["file0.ts", "file2.ts"], symbols: [] },
    ];

    const response = buildDbPackagesResponse(externals);
    // Unique importers: file0.ts, file1.ts, file2.ts = 3
    expect(response.totalImporters).toBe(3);
  });

  it("returns empty structure when no database packages found", () => {
    const response = buildDbPackagesResponse([makeExt("react", 10)]);
    expect(response.totalPackages).toBe(0);
    expect(response.matches).toEqual([]);
    expect(response.categories).toEqual([]);
    expect(response.totalImporters).toBe(0);
  });

  it("returns empty structure for empty input", () => {
    const response = buildDbPackagesResponse([]);
    expect(response.totalPackages).toBe(0);
    expect(response.matches).toEqual([]);
    expect(response.categories).toEqual([]);
    expect(response.totalImporters).toBe(0);
  });

  it("preserves category order (driver, orm, query-builder, migration, cache)", () => {
    const externals = [
      makeExt("redis", 1),      // cache
      makeExt("pg", 1),         // driver
      makeExt("db-migrate", 1), // migration
      makeExt("prisma", 1),     // orm
      makeExt("knex", 1),       // query-builder
    ];

    const response = buildDbPackagesResponse(externals);
    const categoryOrder = response.categories.map((c) => c.category);
    expect(categoryOrder).toEqual(["driver", "orm", "query-builder", "migration", "cache"]);
  });

  it("includes symbols in match output", () => {
    const externals = [makeExt("pg", 2, ["Pool", "Client"])];
    const response = buildDbPackagesResponse(externals);
    expect(response.matches[0].symbols).toEqual(["Pool", "Client"]);
  });

  it("includes importedBy in match output", () => {
    const externals = [makeExt("pg", 3)];
    const response = buildDbPackagesResponse(externals);
    expect(response.matches[0].importedBy).toHaveLength(3);
  });

  it("aggregates cloud + traditional drivers in same category", () => {
    // Use ExternalImport with unique file names to avoid overlap from makeExt
    const externals: ExternalImport[] = [
      { package: "pg", importedBy: ["db.ts", "repo.ts", "seed.ts"], symbols: ["Pool"] },
      { package: "@aws-sdk/client-dynamodb", importedBy: ["dynamo.ts", "lambda.ts"], symbols: ["DynamoDB"] },
      { package: "@google-cloud/firestore", importedBy: ["fire.ts"], symbols: ["Firestore"] },
    ];
    const response = buildDbPackagesResponse(externals);
    const driver = response.categories.find((c) => c.category === "driver")!;
    expect(driver.packageCount).toBe(3);
    // totalImporters = 3 + 2 + 1 = 6 unique files
    expect(driver.totalImporters).toBe(6);
  });
});

// ── DB_CATEGORY_LABELS (shared) ────────────────────────────────────

describe("DB_CATEGORY_LABELS (shared)", () => {
  it("has a label for every category", () => {
    const categories: DbCategory[] = ["driver", "orm", "query-builder", "migration", "cache"];
    for (const cat of categories) {
      expect(DB_CATEGORY_LABELS[cat]).toBeTruthy();
    }
  });
});
