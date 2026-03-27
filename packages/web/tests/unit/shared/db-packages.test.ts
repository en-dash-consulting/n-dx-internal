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
