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

  // ── Config JSON scanning ────────────────────────────────────────────

  it("scans hench config.json and produces config entries", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await mkdir(join(tmpDir, ".hench"), { recursive: true });
    await writeFile(
      join(tmpDir, ".hench/config.json"),
      JSON.stringify({ schema: "hench/v1", provider: "cli", model: "sonnet", maxTurns: 50 }),
    );

    const inventory = makeInventory([]);
    const result = analyzeConfigSurface(tmpDir, inventory, {
      configJsonPaths: [".hench/config.json"],
    });

    const configEntries = result.entries.filter(
      (e) => e.type === "config" && e.file === ".hench/config.json",
    );
    expect(configEntries.length).toBe(4);
    expect(configEntries.map((e) => e.name).sort()).toEqual([
      "maxTurns", "model", "provider", "schema",
    ]);

    const provider = configEntries.find((e) => e.name === "provider");
    expect(provider?.value).toBe("cli");
    expect(provider?.line).toBe(0);
    expect(provider?.referencedBy).toEqual([]);
  });

  it("scans rex config.json and produces config entries", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    await writeFile(
      join(tmpDir, ".rex/config.json"),
      JSON.stringify({ schema: "rex/v1", project: "my-app", adapter: "file" }),
    );

    const inventory = makeInventory([]);
    const result = analyzeConfigSurface(tmpDir, inventory, {
      configJsonPaths: [".rex/config.json"],
    });

    const configEntries = result.entries.filter(
      (e) => e.type === "config" && e.file === ".rex/config.json",
    );
    expect(configEntries.length).toBe(3);
    expect(configEntries.map((e) => e.name).sort()).toEqual([
      "adapter", "project", "schema",
    ]);
    expect(configEntries.find((e) => e.name === "project")?.value).toBe("my-app");
  });

  it("flattens nested config JSON with dot notation", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await mkdir(join(tmpDir, ".hench"), { recursive: true });
    await writeFile(
      join(tmpDir, ".hench/config.json"),
      JSON.stringify({
        guard: {
          commandTimeout: 30000,
          maxFileSize: 1048576,
        },
        retry: {
          maxRetries: 3,
        },
      }),
    );

    const inventory = makeInventory([]);
    const result = analyzeConfigSurface(tmpDir, inventory, {
      configJsonPaths: [".hench/config.json"],
    });

    const configEntries = result.entries.filter(
      (e) => e.type === "config" && e.file === ".hench/config.json",
    );
    expect(configEntries.map((e) => e.name).sort()).toEqual([
      "guard.commandTimeout",
      "guard.maxFileSize",
      "retry.maxRetries",
    ]);
    expect(configEntries.find((e) => e.name === "guard.commandTimeout")?.value).toBe("30000");
    expect(configEntries.find((e) => e.name === "retry.maxRetries")?.value).toBe("3");
  });

  it("represents array values as JSON strings in config entries", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await mkdir(join(tmpDir, ".hench"), { recursive: true });
    await writeFile(
      join(tmpDir, ".hench/config.json"),
      JSON.stringify({
        guard: {
          blockedPaths: [".hench/**", ".git/**"],
          allowedCommands: ["npm", "node"],
        },
      }),
    );

    const inventory = makeInventory([]);
    const result = analyzeConfigSurface(tmpDir, inventory, {
      configJsonPaths: [".hench/config.json"],
    });

    const blocked = result.entries.find((e) => e.name === "guard.blockedPaths");
    expect(blocked?.value).toBe('[".hench/**",".git/**"]');
    expect(blocked?.type).toBe("config");
  });

  it("gracefully handles missing config JSON files (no crash)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));

    const inventory = makeInventory([]);
    const result = analyzeConfigSurface(tmpDir, inventory, {
      configJsonPaths: [".hench/config.json", ".rex/config.json"],
    });

    // No crash, empty entries
    expect(result.entries).toEqual([]);
    expect(result.summary.totalConfigRefs).toBe(0);
  });

  it("gracefully handles malformed config JSON files", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await mkdir(join(tmpDir, ".hench"), { recursive: true });
    await writeFile(join(tmpDir, ".hench/config.json"), "{ not valid json");

    const inventory = makeInventory([]);
    const result = analyzeConfigSurface(tmpDir, inventory, {
      configJsonPaths: [".hench/config.json"],
    });

    expect(result.entries).toEqual([]);
  });

  it("includes config JSON entries in totalConfigRefs summary count", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await mkdir(join(tmpDir, ".hench"), { recursive: true });
    await writeFile(
      join(tmpDir, ".hench/config.json"),
      JSON.stringify({ provider: "cli", model: "sonnet" }),
    );
    // Also add a source file that references a config file
    await writeFile(
      join(tmpDir, "loader.ts"),
      `const c = readFile(".env.production");\n`,
    );

    const inventory = makeInventory([{ path: "loader.ts" }]);
    const result = analyzeConfigSurface(tmpDir, inventory, {
      configJsonPaths: [".hench/config.json"],
    });

    // 2 config JSON fields + at least 1 config file reference from source
    expect(result.summary.totalConfigRefs).toBeGreaterThanOrEqual(3);
  });

  it("scans multiple config JSON files simultaneously", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await mkdir(join(tmpDir, ".hench"), { recursive: true });
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    await writeFile(
      join(tmpDir, ".hench/config.json"),
      JSON.stringify({ provider: "cli" }),
    );
    await writeFile(
      join(tmpDir, ".rex/config.json"),
      JSON.stringify({ adapter: "file" }),
    );

    const inventory = makeInventory([]);
    const result = analyzeConfigSurface(tmpDir, inventory, {
      configJsonPaths: [".hench/config.json", ".rex/config.json"],
    });

    const henchEntries = result.entries.filter((e) => e.file === ".hench/config.json");
    const rexEntries = result.entries.filter((e) => e.file === ".rex/config.json");
    expect(henchEntries).toHaveLength(1);
    expect(rexEntries).toHaveLength(1);
    expect(henchEntries[0].name).toBe("provider");
    expect(rexEntries[0].name).toBe("adapter");
  });

  it("handles boolean and null values in config JSON", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await mkdir(join(tmpDir, ".hench"), { recursive: true });
    await writeFile(
      join(tmpDir, ".hench/config.json"),
      JSON.stringify({ selfHeal: true, debug: false, extra: null }),
    );

    const inventory = makeInventory([]);
    const result = analyzeConfigSurface(tmpDir, inventory, {
      configJsonPaths: [".hench/config.json"],
    });

    const entries = result.entries.filter((e) => e.file === ".hench/config.json");
    expect(entries.find((e) => e.name === "selfHeal")?.value).toBe("true");
    expect(entries.find((e) => e.name === "debug")?.value).toBe("false");
    // null values should still appear
    expect(entries.find((e) => e.name === "extra")).toBeDefined();
  });

  // ── Go viper config patterns ──────────────────────────────────────

  it("detects Go viper.GetString and viper.GetInt config reads", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "server.go"),
      `package main

import "github.com/spf13/viper"

func main() {
  port := viper.GetString("server.port")
  timeout := viper.GetInt("server.timeout")
  debug := viper.GetBool("debug")
}
`,
    );

    const inventory = makeInventory([{ path: "server.go", language: "Go" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const configEntries = result.entries.filter((e) => e.type === "config");
    expect(configEntries).toHaveLength(3);
    expect(configEntries.map((e) => e.name).sort()).toEqual([
      "debug", "server.port", "server.timeout",
    ]);
  });

  it("detects Go viper.SetDefault config declarations", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "config.go"),
      `package main

import "github.com/spf13/viper"

func init() {
  viper.SetDefault("server.port", "8080")
  viper.SetDefault("log.level", "info")
}
`,
    );

    const inventory = makeInventory([{ path: "config.go", language: "Go" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const configEntries = result.entries.filter((e) => e.type === "config");
    expect(configEntries).toHaveLength(2);
    expect(configEntries.map((e) => e.name).sort()).toEqual([
      "log.level", "server.port",
    ]);
  });

  // ── Go flag definitions ───────────────────────────────────────────

  it("detects Go flag.String and flag.Int definitions", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "main.go"),
      `package main

import "flag"

func main() {
  port := flag.String("port", "8080", "port to listen on")
  verbose := flag.Bool("verbose", false, "enable verbose logging")
  timeout := flag.Int("timeout", 30, "request timeout in seconds")
  flag.Parse()
}
`,
    );

    const inventory = makeInventory([{ path: "main.go", language: "Go" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const configEntries = result.entries.filter((e) => e.type === "config");
    expect(configEntries).toHaveLength(3);
    expect(configEntries.map((e) => e.name).sort()).toEqual([
      "port", "timeout", "verbose",
    ]);
  });

  it("detects Go pflag definitions (cobra/pflag)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "cmd.go"),
      `package cmd

import "github.com/spf13/pflag"

func init() {
  pflag.String("config", "", "config file path")
  pflag.IntP("port", "p", 8080, "port to listen on")
  pflag.BoolVar(&verbose, "verbose", false, "verbose output")
}
`,
    );

    const inventory = makeInventory([{ path: "cmd.go", language: "Go" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const configEntries = result.entries.filter((e) => e.type === "config");
    expect(configEntries).toHaveLength(3);
    expect(configEntries.map((e) => e.name).sort()).toEqual([
      "config", "port", "verbose",
    ]);
  });

  // ── Go struct env tags ────────────────────────────────────────────

  it("detects Go struct env tags as env var entries", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "config.go"),
      `package main

type Config struct {
  Port     string ` + "`" + `env:"PORT" default:"8080"` + "`" + `
  Host     string ` + "`" + `env:"HOST"` + "`" + `
  LogLevel string ` + "`" + `json:"log_level" env:"LOG_LEVEL"` + "`" + `
}
`,
    );

    const inventory = makeInventory([{ path: "config.go", language: "Go" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const envEntries = result.entries.filter((e) => e.type === "env");
    expect(envEntries).toHaveLength(3);
    expect(envEntries.map((e) => e.name).sort()).toEqual([
      "HOST", "LOG_LEVEL", "PORT",
    ]);
  });

  // ── TypeScript Vite define replacements ───────────────────────────

  it("detects Vite define replacements in vite.config.ts", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "vite.config.ts"),
      `import { defineConfig } from "vite";

export default defineConfig({
  define: {
    '__APP_VERSION__': JSON.stringify('1.0.0'),
    '__BUILD_TIME__': JSON.stringify(Date.now()),
  },
});
`,
    );

    const inventory = makeInventory([{ path: "vite.config.ts" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const constants = result.entries.filter((e) => e.type === "constant");
    expect(constants.map((e) => e.name).sort()).toEqual([
      "__APP_VERSION__", "__BUILD_TIME__",
    ]);
  });

  it("detects Vite define replacements with double quotes", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await writeFile(
      join(tmpDir, "vite.config.ts"),
      `import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "import.meta.env.SSR": "false",
  },
});
`,
    );

    const inventory = makeInventory([{ path: "vite.config.ts" }]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    const constants = result.entries.filter((e) => e.type === "constant");
    expect(constants.map((e) => e.name).sort()).toEqual([
      "import.meta.env.SSR", "process.env.NODE_ENV",
    ]);
  });

  // ── Mixed Go + TS project ────────────────────────────────────────

  it("scans both Go and TypeScript files in mixed projects", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));
    await mkdir(join(tmpDir, "api"), { recursive: true });
    await mkdir(join(tmpDir, "web"), { recursive: true });

    // Go API with viper config, flag, and env tags
    await writeFile(
      join(tmpDir, "api/main.go"),
      `package main

import (
  "os"
  "flag"
  "github.com/spf13/viper"
)

type Config struct {
  Port string ` + "`" + `env:"API_PORT"` + "`" + `
}

func main() {
  dbUrl := os.Getenv("DATABASE_URL")
  port := flag.String("port", "8080", "server port")
  host := viper.GetString("server.host")
}
`,
    );

    // TypeScript web app with process.env reads
    await writeFile(
      join(tmpDir, "web/app.ts"),
      `const apiUrl = process.env.API_URL;\nexport const MAX_RETRIES = 3;\n`,
    );

    const inventory = makeInventory([
      { path: "api/main.go", language: "Go" },
      { path: "web/app.ts", language: "TypeScript" },
    ]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    // Should detect env vars from both languages
    const envEntries = result.entries.filter((e) => e.type === "env");
    const envNames = envEntries.map((e) => e.name).sort();
    expect(envNames).toContain("DATABASE_URL");
    expect(envNames).toContain("API_PORT");
    expect(envNames).toContain("API_URL");

    // Should detect Go config reads (viper + flag)
    const configEntries = result.entries.filter((e) => e.type === "config");
    expect(configEntries.map((e) => e.name)).toContain("server.host");
    expect(configEntries.map((e) => e.name)).toContain("port");

    // Should detect TS constants
    const constants = result.entries.filter((e) => e.type === "constant");
    expect(constants.map((e) => e.name)).toContain("MAX_RETRIES");
  });

  // ── Existing patterns still work ─────────────────────────────────

  it("existing process.env and os.Getenv patterns still work alongside new patterns", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-config-"));

    // Go file with both os.Getenv and viper
    await writeFile(
      join(tmpDir, "server.go"),
      `package main

import (
  "os"
  "github.com/spf13/viper"
)

func main() {
  port := os.Getenv("PORT")
  host := viper.GetString("server.host")
}
`,
    );

    // TS file with process.env
    await writeFile(
      join(tmpDir, "client.ts"),
      `const apiKey = process.env.API_KEY;\n`,
    );

    const inventory = makeInventory([
      { path: "server.go", language: "Go" },
      { path: "client.ts", language: "TypeScript" },
    ]);
    const result = analyzeConfigSurface(tmpDir, inventory);

    // os.Getenv still detected
    const envEntries = result.entries.filter((e) => e.type === "env");
    expect(envEntries.map((e) => e.name)).toContain("PORT");
    expect(envEntries.map((e) => e.name)).toContain("API_KEY");

    // Viper detected as config
    const configEntries = result.entries.filter((e) => e.type === "config");
    expect(configEntries.map((e) => e.name)).toContain("server.host");
  });
});
