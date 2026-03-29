import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeConfigSurface } from "../../../src/analyzers/config-surface.js";
import type { Inventory, FileEntry } from "../../../src/schema/v1.js";

function makeInventory(files: Array<{ path: string; language?: string; role?: string }>): Inventory {
  return {
    files: files.map((f) => ({
      path: f.path,
      size: 100,
      language: f.language ?? "TypeScript",
      lineCount: 10,
      hash: "abc123",
      role: (f.role ?? "source") as FileEntry["role"],
      category: "general",
    })),
    summary: {
      totalFiles: files.length,
      totalLines: files.length * 10,
      byLanguage: {},
      byRole: {},
      byCategory: {},
    },
  };
}

describe("analyzeConfigSurface", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("produces empty output for a project with no env vars", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(join(tmpDir, "main.ts"), `export function hello() { return "world"; }\n`);

    const inventory = makeInventory([{ path: "main.ts" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    expect(result.entries).toEqual([]);
    expect(result.summary).toEqual({
      totalEnvVars: 0,
      totalConfigRefs: 0,
      totalConstants: 0,
    });
  });

  it("detects process.env.* reads in TypeScript", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "config.ts"),
      `const port = process.env.PORT;\nconst host = process.env.HOST;\n`,
    );

    const inventory = makeInventory([{ path: "config.ts" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const envEntries = result.entries.filter((e) => e.type === "env");
    expect(envEntries).toHaveLength(2);
    expect(envEntries.map((e) => e.name).sort()).toEqual(["HOST", "PORT"]);
    expect(result.summary.totalEnvVars).toBe(2);
  });

  it("detects process.env bracket access", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "config.ts"),
      `const key = process.env["API_KEY"];\nconst secret = process.env['API_SECRET'];\n`,
    );

    const inventory = makeInventory([{ path: "config.ts" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const envEntries = result.entries.filter((e) => e.type === "env");
    expect(envEntries).toHaveLength(2);
    expect(envEntries.map((e) => e.name).sort()).toEqual(["API_KEY", "API_SECRET"]);
  });

  it("detects destructured process.env", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "config.ts"),
      `const { PORT, HOST, DATABASE_URL } = process.env;\n`,
    );

    const inventory = makeInventory([{ path: "config.ts" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const envEntries = result.entries.filter((e) => e.type === "env");
    expect(envEntries).toHaveLength(3);
    expect(envEntries.map((e) => e.name).sort()).toEqual(["DATABASE_URL", "HOST", "PORT"]);
  });

  it("detects import.meta.env reads (Vite-style)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "app.ts"),
      `const apiUrl = import.meta.env.VITE_API_URL;\n`,
    );

    const inventory = makeInventory([{ path: "app.ts" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const envEntries = result.entries.filter((e) => e.type === "env");
    expect(envEntries).toHaveLength(1);
    expect(envEntries[0].name).toBe("VITE_API_URL");
  });

  it("detects Go os.Getenv and os.LookupEnv", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "main.go"),
      `package main\nimport "os"\nfunc main() {\n  port := os.Getenv("PORT")\n  host, ok := os.LookupEnv("HOST")\n}\n`,
    );

    const inventory = makeInventory([{ path: "main.go", language: "Go" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const envEntries = result.entries.filter((e) => e.type === "env");
    expect(envEntries).toHaveLength(2);
    expect(envEntries.map((e) => e.name).sort()).toEqual(["HOST", "PORT"]);
  });

  it("detects config file references", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "loader.ts"),
      `import { readFile } from "fs";\nconst config = readFile(".env.production");\nconst yaml = readFile("./config.yaml");\n`,
    );

    const inventory = makeInventory([{ path: "loader.ts" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const configEntries = result.entries.filter((e) => e.type === "config");
    expect(configEntries.length).toBeGreaterThanOrEqual(2);
    expect(result.summary.totalConfigRefs).toBeGreaterThanOrEqual(2);
  });

  it("detects exported top-level constants in TypeScript", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "constants.ts"),
      `export const MAX_RETRIES = 3;\nexport const API_BASE_URL = "https://api.example.com";\nconst TIMEOUT_MS = 5000;\n\nfunction inner() {\n  const LOCAL_VAR = 42;\n}\n`,
    );

    const inventory = makeInventory([{ path: "constants.ts" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const constants = result.entries.filter((e) => e.type === "constant");
    expect(constants).toHaveLength(2);
    expect(constants.map((c) => c.name).sort()).toEqual(["API_BASE_URL", "MAX_RETRIES"]);

    // Non-exported TIMEOUT_MS should be excluded
    expect(constants.map((c) => c.name)).not.toContain("TIMEOUT_MS");

    const maxRetries = constants.find((c) => c.name === "MAX_RETRIES");
    expect(maxRetries?.value).toBe("3");

    const apiUrl = constants.find((c) => c.name === "API_BASE_URL");
    expect(apiUrl?.value).toBe("https://api.example.com");
  });

  it("detects exported Go constants (capitalized names only)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "constants.go"),
      `package main\n\nconst MaxRetries int = 3\n\nconst (\n  DefaultPort string = "8080"\n  DefaultHost string = "localhost"\n)\n`,
    );

    const inventory = makeInventory([{ path: "constants.go", language: "Go" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const constants = result.entries.filter((e) => e.type === "constant");
    expect(constants).toHaveLength(3);
    expect(constants.map((c) => c.name).sort()).toEqual(["DefaultHost", "DefaultPort", "MaxRetries"]);

    const maxRetries = constants.find((c) => c.name === "MaxRetries");
    expect(maxRetries?.value).toBe("3");

    const defaultPort = constants.find((c) => c.name === "DefaultPort");
    expect(defaultPort?.value).toBe("8080");
  });

  it("excludes non-exported TS constants (no export keyword)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "internal.ts"),
      `const PRIVATE_TIMEOUT = 5000;\nconst INTERNAL_URL = "http://localhost";\nexport const PUBLIC_FLAG = true;\n`,
    );

    const inventory = makeInventory([{ path: "internal.ts" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const constants = result.entries.filter((e) => e.type === "constant");
    expect(constants).toHaveLength(1);
    expect(constants[0].name).toBe("PUBLIC_FLAG");
    expect(constants[0].value).toBe("true");
  });

  it("excludes non-exported Go constants (lowercase names)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "internal.go"),
      `package main\n\nconst maxRetries int = 3\nconst PublicTimeout int = 5000\n\nconst (\n  defaultPort string = "8080"\n  DefaultHost string = "localhost"\n)\n`,
    );

    const inventory = makeInventory([{ path: "internal.go", language: "Go" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const constants = result.entries.filter((e) => e.type === "constant");
    expect(constants).toHaveLength(2);
    expect(constants.map((c) => c.name).sort()).toEqual(["DefaultHost", "PublicTimeout"]);

    // Lowercase Go identifiers should be excluded
    expect(constants.map((c) => c.name)).not.toContain("maxRetries");
    expect(constants.map((c) => c.name)).not.toContain("defaultPort");
  });

  it("deduplicates env vars by name, keeping first occurrence", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src/a.ts"), `const port = process.env.PORT;\n`);
    await writeFile(join(tmpDir, "src/b.ts"), `const p = process.env.PORT;\n`);

    const inventory = makeInventory([
      { path: "src/a.ts" },
      { path: "src/b.ts" },
    ]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const envEntries = result.entries.filter((e) => e.type === "env");
    expect(envEntries).toHaveLength(1);
    expect(envEntries[0].name).toBe("PORT");
    expect(result.summary.totalEnvVars).toBe(1);
  });

  it("adds zone attribution when fileToZone is provided", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(join(tmpDir, "config.ts"), `const port = process.env.PORT;\n`);

    const inventory = makeInventory([{ path: "config.ts" }]);
    const fileToZone = new Map([["config.ts", "server-core"]]);
    const result = analyzeConfigSurface(tmpDir, inventory, { fileToZone });

    const envEntries = result.entries.filter((e) => e.type === "env");
    expect(envEntries).toHaveLength(1);
    expect(envEntries[0].referencedBy).toEqual(["server-core"]);
  });

  it("merges zone references for deduplicated env vars", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src/a.ts"), `const port = process.env.PORT;\n`);
    await writeFile(join(tmpDir, "src/b.ts"), `const p = process.env.PORT;\n`);

    const inventory = makeInventory([
      { path: "src/a.ts" },
      { path: "src/b.ts" },
    ]);
    const fileToZone = new Map([
      ["src/a.ts", "zone-alpha"],
      ["src/b.ts", "zone-beta"],
    ]);
    const result = analyzeConfigSurface(tmpDir, inventory, { fileToZone });

    const envEntries = result.entries.filter((e) => e.type === "env");
    expect(envEntries).toHaveLength(1);
    expect(envEntries[0].referencedBy.sort()).toEqual(["zone-alpha", "zone-beta"]);
  });

  it("skips non-source files (test, docs, etc.)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(join(tmpDir, "test.ts"), `const port = process.env.PORT;\n`);

    const inventory = makeInventory([{ path: "test.ts", role: "test" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    expect(result.entries).toHaveLength(0);
  });

  it("handles missing files gracefully", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));

    const inventory = makeInventory([{ path: "nonexistent.ts" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    expect(result.entries).toEqual([]);
    expect(result.summary.totalEnvVars).toBe(0);
  });

  it("entries are sorted by type then name", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "mixed.ts"),
      `export const ZEBRA_CONST = "z";\nconst port = process.env.PORT;\nconst url = process.env.API_URL;\nexport const ALPHA_CONST = "a";\n`,
    );

    const inventory = makeInventory([{ path: "mixed.ts" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const names = result.entries.map((e) => `${e.type}:${e.name}`);
    // Constants come after env vars alphabetically
    expect(names.indexOf("constant:ALPHA_CONST")).toBeGreaterThan(names.indexOf("env:PORT"));
    expect(names.indexOf("env:API_URL")).toBeLessThan(names.indexOf("env:PORT"));
  });
});
