import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  analyzeFrameworks,
  FRAMEWORK_REGISTRY,
  detectJSWorkspaceRoots,
  detectGoModuleRoots,
  detectMonorepoRoots,
  parsePnpmWorkspacePatterns,
} from "../../../src/analyzers/framework-detection.js";
import type { Inventory, Imports, FileEntry, FrameworkRegistryEntry } from "../../../src/schema/v1.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function makeImports(external: Array<{ package: string; importedBy: string[] }>): Imports {
  return {
    edges: [],
    external: external.map((e) => ({
      package: e.package,
      importedBy: e.importedBy,
      symbols: [],
    })),
    summary: {
      totalEdges: 0,
      totalExternal: external.length,
      circularCount: 0,
      circulars: [],
      mostImported: [],
      avgImportsPerFile: 0,
    },
  };
}

const EMPTY_IMPORTS = makeImports([]);

// ── Tests ───────────────────────────────────────────────────────────────────

describe("FRAMEWORK_REGISTRY", () => {
  it("contains at least 14 framework entries", () => {
    expect(FRAMEWORK_REGISTRY.length).toBeGreaterThanOrEqual(14);
  });

  it("each entry has required fields", () => {
    for (const entry of FRAMEWORK_REGISTRY) {
      expect(entry.id).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(["frontend", "backend", "fullstack"]).toContain(entry.category);
      expect(["typescript", "go"]).toContain(entry.language);
      expect(entry.detectionSignals).toBeDefined();

      // At least one signal type must be defined
      const ds = entry.detectionSignals;
      const hasSignals =
        (ds.filePatterns && ds.filePatterns.length > 0) ||
        (ds.configFiles && ds.configFiles.length > 0) ||
        (ds.importPatterns && ds.importPatterns.length > 0) ||
        (ds.methodCallPatterns && ds.methodCallPatterns.length > 0);
      expect(hasSignals).toBe(true);
    }
  });

  it("has unique IDs", () => {
    const ids = FRAMEWORK_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers all required frameworks", () => {
    const ids = new Set(FRAMEWORK_REGISTRY.map((e) => e.id));
    // Frontend
    expect(ids.has("react-router-v7")).toBe(true);
    expect(ids.has("nextjs")).toBe(true);
    expect(ids.has("nuxt")).toBe(true);
    expect(ids.has("sveltekit")).toBe(true);
    expect(ids.has("astro")).toBe(true);
    // Backend JS/TS
    expect(ids.has("express")).toBe(true);
    expect(ids.has("hono")).toBe(true);
    expect(ids.has("koa")).toBe(true);
    // Backend Go
    expect(ids.has("go-chi")).toBe(true);
    expect(ids.has("go-gin")).toBe(true);
    expect(ids.has("go-echo")).toBe(true);
    expect(ids.has("go-fiber")).toBe(true);
    expect(ids.has("go-gorilla-mux")).toBe(true);
    expect(ids.has("go-net-http")).toBe(true);
  });
});

describe("analyzeFrameworks", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns empty result for a project with no frameworks", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "src/index.ts" }]);
    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    expect(result.frameworks).toEqual([]);
    expect(result.summary.totalDetected).toBe(0);
  });

  // ── Import-based detection ──────────────────────────────────────────

  it("detects Express via import pattern", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "src/server.ts" }]);
    const imports = makeImports([{ package: "express", importedBy: ["src/server.ts"] }]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    const express = result.frameworks.find((f) => f.id === "express");
    expect(express).toBeDefined();
    expect(express!.confidence).toBeGreaterThanOrEqual(0.45);
    expect(express!.detectedSignals.some((s) => s.kind === "import")).toBe(true);
  });

  it("detects React Router v7 via import pattern", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "app/root.tsx" }]);
    const imports = makeImports([{ package: "react-router", importedBy: ["app/root.tsx"] }]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    const rr = result.frameworks.find((f) => f.id === "react-router-v7");
    expect(rr).toBeDefined();
    expect(rr!.confidence).toBeGreaterThanOrEqual(0.45);
  });

  it("detects Next.js via import pattern with subpath", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "app/page.tsx" }]);
    const imports = makeImports([
      { package: "next/navigation", importedBy: ["app/page.tsx"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    const next = result.frameworks.find((f) => f.id === "nextjs");
    expect(next).toBeDefined();
  });

  it("detects Go chi via import pattern", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "main.go", language: "Go" }]);
    const imports = makeImports([
      { package: "github.com/go-chi/chi/v5", importedBy: ["main.go"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    const chi = result.frameworks.find((f) => f.id === "go-chi");
    expect(chi).toBeDefined();
    expect(chi!.language).toBe("go");
    expect(chi!.category).toBe("backend");
  });

  it("detects Go net/http via import pattern", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "main.go", language: "Go" }]);
    const imports = makeImports([
      { package: "net/http", importedBy: ["main.go"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    const netHttp = result.frameworks.find((f) => f.id === "go-net-http");
    expect(netHttp).toBeDefined();
  });

  // ── Config file detection ───────────────────────────────────────────

  it("detects Next.js via config file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    await writeFile(join(tmpDir, "next.config.js"), "module.exports = {};\n");

    const inventory = makeInventory([{ path: "src/app.tsx" }]);
    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    const next = result.frameworks.find((f) => f.id === "nextjs");
    expect(next).toBeDefined();
    expect(next!.confidence).toBeGreaterThanOrEqual(0.5);
    expect(next!.detectedSignals.some((s) => s.kind === "config")).toBe(true);
  });

  it("detects SvelteKit via config file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    await writeFile(join(tmpDir, "svelte.config.js"), "export default {};\n");

    const inventory = makeInventory([{ path: "src/routes/+page.svelte" }]);
    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    const sk = result.frameworks.find((f) => f.id === "sveltekit");
    expect(sk).toBeDefined();
    expect(sk!.detectedSignals.some((s) => s.kind === "config")).toBe(true);
  });

  it("detects Astro via config file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    await writeFile(join(tmpDir, "astro.config.mjs"), "export default {};\n");

    const inventory = makeInventory([{ path: "src/pages/index.astro" }]);
    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    const astro = result.frameworks.find((f) => f.id === "astro");
    expect(astro).toBeDefined();
  });

  it("detects React Router v7 via config file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    await writeFile(join(tmpDir, "react-router.config.ts"), "export default {};\n");

    const inventory = makeInventory([{ path: "app/root.tsx" }]);
    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    const rr = result.frameworks.find((f) => f.id === "react-router-v7");
    expect(rr).toBeDefined();
  });

  // ── File pattern detection ──────────────────────────────────────────

  it("detects React Router v7 via file patterns", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([
      { path: "app/routes/home.tsx" },
      { path: "app/routes/about.tsx" },
      { path: "app/routes/users.$id.tsx" },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    const rr = result.frameworks.find((f) => f.id === "react-router-v7");
    expect(rr).toBeDefined();
    expect(rr!.detectedSignals.some((s) => s.kind === "file")).toBe(true);
  });

  it("detects Next.js via pages file patterns", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([
      { path: "pages/index.tsx" },
      { path: "pages/about.tsx" },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    const next = result.frameworks.find((f) => f.id === "nextjs");
    expect(next).toBeDefined();
  });

  it("detects Next.js via app router file patterns", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([
      { path: "app/page.tsx" },
      { path: "app/about/page.tsx" },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    const next = result.frameworks.find((f) => f.id === "nextjs");
    expect(next).toBeDefined();
  });

  it("detects Nuxt via file patterns", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([
      { path: "pages/index.vue" },
      { path: "layouts/default.vue" },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    const nuxt = result.frameworks.find((f) => f.id === "nuxt");
    expect(nuxt).toBeDefined();
  });

  it("detects SvelteKit via file patterns", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([
      { path: "src/routes/+page.svelte" },
      { path: "src/routes/about/+page.svelte" },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    const sk = result.frameworks.find((f) => f.id === "sveltekit");
    expect(sk).toBeDefined();
  });

  it("detects Astro via file patterns", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([
      { path: "src/pages/index.astro" },
      { path: "src/layouts/main.astro" },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    const astro = result.frameworks.find((f) => f.id === "astro");
    expect(astro).toBeDefined();
  });

  // ── Confidence scoring ──────────────────────────────────────────────

  it("scores high confidence when multiple signal types match", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    await writeFile(join(tmpDir, "next.config.js"), "module.exports = {};\n");

    const inventory = makeInventory([
      { path: "app/page.tsx" },
      { path: "app/about/page.tsx" },
    ]);
    const imports = makeImports([
      { package: "next", importedBy: ["app/page.tsx"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    const next = result.frameworks.find((f) => f.id === "nextjs");
    expect(next).toBeDefined();
    // config (0.5) + import (0.45) + file (0.3) + bonus (0.15) = 1.0 (capped)
    expect(next!.confidence).toBeGreaterThan(0.8);
    expect(next!.detectedSignals.length).toBeGreaterThanOrEqual(3);
  });

  it("scores medium confidence for single import signal", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "src/server.ts" }]);
    const imports = makeImports([{ package: "express", importedBy: ["src/server.ts"] }]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    const express = result.frameworks.find((f) => f.id === "express");
    expect(express).toBeDefined();
    expect(express!.confidence).toBeGreaterThanOrEqual(0.4);
    expect(express!.confidence).toBeLessThanOrEqual(0.8);
  });

  it("scores lower confidence for file-only signal", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([
      { path: "app/routes/home.tsx" },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    const rr = result.frameworks.find((f) => f.id === "react-router-v7");
    expect(rr).toBeDefined();
    expect(rr!.confidence).toBeLessThanOrEqual(0.5);
  });

  // ── Sorting and summary ─────────────────────────────────────────────

  it("sorts frameworks by confidence descending", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    await writeFile(join(tmpDir, "next.config.js"), "module.exports = {};\n");

    const inventory = makeInventory([
      { path: "app/page.tsx" },
      { path: "src/server.ts" },
    ]);
    const imports = makeImports([
      { package: "next", importedBy: ["app/page.tsx"] },
      { package: "express", importedBy: ["src/server.ts"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    // Next.js has config + import + file = higher confidence than Express (import only)
    expect(result.frameworks.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < result.frameworks.length; i++) {
      expect(result.frameworks[i - 1].confidence).toBeGreaterThanOrEqual(
        result.frameworks[i].confidence,
      );
    }
  });

  it("builds correct summary statistics", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([
      { path: "src/server.ts" },
      { path: "main.go", language: "Go" },
    ]);
    const imports = makeImports([
      { package: "express", importedBy: ["src/server.ts"] },
      { package: "github.com/go-chi/chi/v5", importedBy: ["main.go"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    expect(result.summary.totalDetected).toBeGreaterThanOrEqual(2);
    expect(result.summary.byCategory.backend).toBeGreaterThanOrEqual(2);
    expect(result.summary.byLanguage.typescript).toBeGreaterThanOrEqual(1);
    expect(result.summary.byLanguage.go).toBeGreaterThanOrEqual(1);
  });

  // ── Project root ────────────────────────────────────────────────────

  it("includes projectRoot in detected frameworks", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "src/server.ts" }]);
    const imports = makeImports([{ package: "express", importedBy: ["src/server.ts"] }]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    const express = result.frameworks.find((f) => f.id === "express");
    expect(express).toBeDefined();
    expect(express!.projectRoot).toBe(".");
  });

  // ── Custom registry ─────────────────────────────────────────────────

  it("supports custom registry override", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const customRegistry: FrameworkRegistryEntry[] = [
      {
        id: "custom-fw",
        name: "Custom Framework",
        category: "backend",
        language: "typescript",
        detectionSignals: {
          importPatterns: ["custom-framework"],
        },
      },
    ];

    const inventory = makeInventory([{ path: "src/app.ts" }]);
    const imports = makeImports([{ package: "custom-framework", importedBy: ["src/app.ts"] }]);

    const result = analyzeFrameworks(tmpDir, inventory, imports, { registry: customRegistry });

    expect(result.frameworks).toHaveLength(1);
    expect(result.frameworks[0].id).toBe("custom-fw");
  });

  // ── Multiple Go frameworks ──────────────────────────────────────────

  it("detects multiple Go frameworks in same project", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([
      { path: "main.go", language: "Go" },
      { path: "cmd/server/main.go", language: "Go" },
    ]);
    const imports = makeImports([
      { package: "net/http", importedBy: ["main.go"] },
      { package: "github.com/gin-gonic/gin", importedBy: ["cmd/server/main.go"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    const netHttp = result.frameworks.find((f) => f.id === "go-net-http");
    const gin = result.frameworks.find((f) => f.id === "go-gin");
    expect(netHttp).toBeDefined();
    expect(gin).toBeDefined();
  });

  // ── No false positives ──────────────────────────────────────────────

  it("does not detect frameworks without matching signals", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([
      { path: "src/utils/helper.ts" },
      { path: "src/lib/math.ts" },
    ]);
    const imports = makeImports([
      { package: "lodash", importedBy: ["src/utils/helper.ts"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);
    expect(result.frameworks).toEqual([]);
    expect(result.summary.totalDetected).toBe(0);
  });

  // ── All Go frameworks ───────────────────────────────────────────────

  it("detects gorilla/mux via import", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "main.go", language: "Go" }]);
    const imports = makeImports([
      { package: "github.com/gorilla/mux", importedBy: ["main.go"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);
    expect(result.frameworks.find((f) => f.id === "go-gorilla-mux")).toBeDefined();
  });

  it("detects echo via import", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "main.go", language: "Go" }]);
    const imports = makeImports([
      { package: "github.com/labstack/echo/v4", importedBy: ["main.go"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);
    expect(result.frameworks.find((f) => f.id === "go-echo")).toBeDefined();
  });

  it("detects fiber via import", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "main.go", language: "Go" }]);
    const imports = makeImports([
      { package: "github.com/gofiber/fiber/v2", importedBy: ["main.go"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);
    expect(result.frameworks.find((f) => f.id === "go-fiber")).toBeDefined();
  });

  // ── Hono and Koa ────────────────────────────────────────────────────

  it("detects Hono via import", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "src/index.ts" }]);
    const imports = makeImports([{ package: "hono", importedBy: ["src/index.ts"] }]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);
    expect(result.frameworks.find((f) => f.id === "hono")).toBeDefined();
  });

  it("detects Koa via import", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "src/index.ts" }]);
    const imports = makeImports([{ package: "koa", importedBy: ["src/index.ts"] }]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);
    expect(result.frameworks.find((f) => f.id === "koa")).toBeDefined();
  });

  // ── Nuxt config detection ──────────────────────────────────────────

  it("detects Nuxt via config file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    await writeFile(join(tmpDir, "nuxt.config.ts"), "export default {};\n");

    const inventory = makeInventory([{ path: "pages/index.vue" }]);
    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    const nuxt = result.frameworks.find((f) => f.id === "nuxt");
    expect(nuxt).toBeDefined();
  });

  // ── Roots output ──────────────────────────────────────────────────

  it("single-root project produces one root entry at '.'", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "src/server.ts" }]);
    const imports = makeImports([{ package: "express", importedBy: ["src/server.ts"] }]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].path).toBe(".");
    expect(result.roots[0].detectedFrameworks.length).toBeGreaterThanOrEqual(1);
    expect(result.roots[0].detectedFrameworks.find((f) => f.id === "express")).toBeDefined();
  });

  it("single-root project root frameworks match top-level frameworks", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-"));
    const inventory = makeInventory([{ path: "src/server.ts" }]);
    const imports = makeImports([{ package: "express", importedBy: ["src/server.ts"] }]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    // The root's frameworks should be the same as the top-level list
    expect(result.roots[0].detectedFrameworks).toEqual(result.frameworks);
  });
});

// ── parsePnpmWorkspacePatterns ────────────────────────────────────────────

describe("parsePnpmWorkspacePatterns", () => {
  it("parses standard pnpm-workspace.yaml", () => {
    const content = `packages:\n  - 'packages/*'\n  - 'apps/*'\n`;
    const patterns = parsePnpmWorkspacePatterns(content);
    expect(patterns).toEqual(["packages/*", "apps/*"]);
  });

  it("parses patterns without quotes", () => {
    const content = `packages:\n  - packages/*\n  - apps/*\n`;
    const patterns = parsePnpmWorkspacePatterns(content);
    expect(patterns).toEqual(["packages/*", "apps/*"]);
  });

  it("parses patterns with double quotes", () => {
    const content = `packages:\n  - "packages/*"\n  - "tools/cli"\n`;
    const patterns = parsePnpmWorkspacePatterns(content);
    expect(patterns).toEqual(["packages/*", "tools/cli"]);
  });

  it("stops at next top-level key", () => {
    const content = `packages:\n  - 'packages/*'\nsomethingElse:\n  key: value\n`;
    const patterns = parsePnpmWorkspacePatterns(content);
    expect(patterns).toEqual(["packages/*"]);
  });

  it("returns empty for file without packages key", () => {
    const content = `overrides:\n  foo: bar\n`;
    const patterns = parsePnpmWorkspacePatterns(content);
    expect(patterns).toEqual([]);
  });

  it("handles empty packages list", () => {
    const content = `packages:\n`;
    const patterns = parsePnpmWorkspacePatterns(content);
    expect(patterns).toEqual([]);
  });
});

// ── detectJSWorkspaceRoots ───────────────────────────────────────────────

describe("detectJSWorkspaceRoots", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects npm/yarn workspace roots from package.json workspaces array", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ws-"));

    // Create workspace structure
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: ["packages/*"],
    }));
    await mkdir(join(tmpDir, "packages", "api"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "api", "package.json"), JSON.stringify({ name: "api" }));
    await mkdir(join(tmpDir, "packages", "web"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "web", "package.json"), JSON.stringify({ name: "web" }));

    const roots = detectJSWorkspaceRoots(tmpDir);
    expect(roots).toEqual(["packages/api", "packages/web"]);
  });

  it("detects yarn workspace roots from { packages: [...] } format", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ws-"));

    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: { packages: ["apps/*"] },
    }));
    await mkdir(join(tmpDir, "apps", "frontend"), { recursive: true });
    await writeFile(join(tmpDir, "apps", "frontend", "package.json"), JSON.stringify({ name: "frontend" }));

    const roots = detectJSWorkspaceRoots(tmpDir);
    expect(roots).toEqual(["apps/frontend"]);
  });

  it("detects pnpm workspace roots from pnpm-workspace.yaml", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ws-"));

    await writeFile(join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    await mkdir(join(tmpDir, "packages", "core"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "core", "package.json"), JSON.stringify({ name: "core" }));

    const roots = detectJSWorkspaceRoots(tmpDir);
    expect(roots).toEqual(["packages/core"]);
  });

  it("skips directories without package.json", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ws-"));

    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: ["packages/*"],
    }));
    await mkdir(join(tmpDir, "packages", "has-pkg"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "has-pkg", "package.json"), JSON.stringify({ name: "has-pkg" }));
    await mkdir(join(tmpDir, "packages", "no-pkg"), { recursive: true });
    // no package.json in no-pkg

    const roots = detectJSWorkspaceRoots(tmpDir);
    expect(roots).toEqual(["packages/has-pkg"]);
  });

  it("skips node_modules directories", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ws-"));

    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: ["packages/*"],
    }));
    await mkdir(join(tmpDir, "packages", "node_modules", "some-pkg"), { recursive: true });
    await writeFile(
      join(tmpDir, "packages", "node_modules", "some-pkg", "package.json"),
      JSON.stringify({ name: "some-pkg" }),
    );

    const roots = detectJSWorkspaceRoots(tmpDir);
    expect(roots).toEqual([]);
  });

  it("returns empty for project without workspaces", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ws-"));
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "single-app" }));

    const roots = detectJSWorkspaceRoots(tmpDir);
    expect(roots).toEqual([]);
  });

  it("handles direct path patterns (no glob)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ws-"));

    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: ["tools/cli"],
    }));
    await mkdir(join(tmpDir, "tools", "cli"), { recursive: true });
    await writeFile(join(tmpDir, "tools", "cli", "package.json"), JSON.stringify({ name: "cli" }));

    const roots = detectJSWorkspaceRoots(tmpDir);
    expect(roots).toEqual(["tools/cli"]);
  });
});

// ── detectGoModuleRoots ──────────────────────────────────────────────────

describe("detectGoModuleRoots", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects nested go.mod files as separate Go project roots", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-go-"));

    // Root go.mod (not counted)
    await writeFile(join(tmpDir, "go.mod"), "module example.com/root\n");
    // Nested go.mod
    await mkdir(join(tmpDir, "services", "api"), { recursive: true });
    await writeFile(join(tmpDir, "services", "api", "go.mod"), "module example.com/services/api\n");

    const roots = detectGoModuleRoots(tmpDir);
    expect(roots).toEqual(["services/api"]);
  });

  it("detects multiple nested go.mod files", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-go-"));

    await mkdir(join(tmpDir, "cmd", "server"), { recursive: true });
    await writeFile(join(tmpDir, "cmd", "server", "go.mod"), "module example.com/cmd/server\n");
    await mkdir(join(tmpDir, "pkg", "lib"), { recursive: true });
    await writeFile(join(tmpDir, "pkg", "lib", "go.mod"), "module example.com/pkg/lib\n");

    const roots = detectGoModuleRoots(tmpDir);
    expect(roots).toEqual(["cmd/server", "pkg/lib"]);
  });

  it("skips vendor and node_modules directories", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-go-"));

    await mkdir(join(tmpDir, "vendor", "github.com", "pkg"), { recursive: true });
    await writeFile(
      join(tmpDir, "vendor", "github.com", "pkg", "go.mod"),
      "module github.com/pkg\n",
    );

    const roots = detectGoModuleRoots(tmpDir);
    expect(roots).toEqual([]);
  });

  it("returns empty for project without nested go.mod", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-go-"));
    // Only root go.mod
    await writeFile(join(tmpDir, "go.mod"), "module example.com/root\n");

    const roots = detectGoModuleRoots(tmpDir);
    expect(roots).toEqual([]);
  });

  it("does not recurse into sub-modules", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-go-"));

    // Nested module
    await mkdir(join(tmpDir, "svc", "api"), { recursive: true });
    await writeFile(join(tmpDir, "svc", "api", "go.mod"), "module example.com/svc/api\n");
    // Deeply nested module (should not be found since we stop at svc/api)
    await mkdir(join(tmpDir, "svc", "api", "internal", "sub"), { recursive: true });
    await writeFile(join(tmpDir, "svc", "api", "internal", "sub", "go.mod"), "module example.com/sub\n");

    const roots = detectGoModuleRoots(tmpDir);
    expect(roots).toEqual(["svc/api"]);
  });
});

// ── detectMonorepoRoots ─────────────────────────────────────────────────

describe("detectMonorepoRoots", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("combines JS workspace and Go module roots", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-mono-"));

    // JS workspace
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: ["packages/*"],
    }));
    await mkdir(join(tmpDir, "packages", "web"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "web", "package.json"), JSON.stringify({ name: "web" }));

    // Go module
    await mkdir(join(tmpDir, "services", "api"), { recursive: true });
    await writeFile(join(tmpDir, "services", "api", "go.mod"), "module example.com/api\n");

    const roots = detectMonorepoRoots(tmpDir);
    expect(roots).toEqual(["packages/web", "services/api"]);
  });

  it("deduplicates roots from multiple detection methods", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-mono-"));

    // A directory that is both a workspace member and has go.mod
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: ["packages/*"],
    }));
    await mkdir(join(tmpDir, "packages", "hybrid"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "hybrid", "package.json"), JSON.stringify({ name: "hybrid" }));
    await writeFile(join(tmpDir, "packages", "hybrid", "go.mod"), "module example.com/hybrid\n");

    const roots = detectMonorepoRoots(tmpDir);
    // Should not duplicate
    expect(roots).toEqual(["packages/hybrid"]);
  });

  it("returns empty for single-root project", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-mono-"));
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "my-app" }));

    const roots = detectMonorepoRoots(tmpDir);
    expect(roots).toEqual([]);
  });
});

// ── Monorepo framework detection (integration) ──────────────────────────

describe("analyzeFrameworks — monorepo", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects frameworks per workspace root", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-mono-"));

    // Set up workspace
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: ["packages/*"],
    }));
    await mkdir(join(tmpDir, "packages", "web"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "web", "package.json"), JSON.stringify({ name: "web" }));
    await mkdir(join(tmpDir, "packages", "api"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "api", "package.json"), JSON.stringify({ name: "api" }));

    const inventory = makeInventory([
      { path: "packages/web/app/routes/home.tsx" },
      { path: "packages/web/app/root.tsx" },
      { path: "packages/api/src/server.ts" },
    ]);
    const imports = makeImports([
      { package: "react-router", importedBy: ["packages/web/app/root.tsx"] },
      { package: "express", importedBy: ["packages/api/src/server.ts"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    // Should have two roots
    expect(result.roots).toHaveLength(2);

    const webRoot = result.roots.find((r) => r.path === "packages/web");
    const apiRoot = result.roots.find((r) => r.path === "packages/api");

    expect(webRoot).toBeDefined();
    expect(apiRoot).toBeDefined();

    // Web root should detect React Router
    expect(webRoot!.detectedFrameworks.find((f) => f.id === "react-router-v7")).toBeDefined();
    // Web root should NOT detect Express
    expect(webRoot!.detectedFrameworks.find((f) => f.id === "express")).toBeUndefined();

    // API root should detect Express
    expect(apiRoot!.detectedFrameworks.find((f) => f.id === "express")).toBeDefined();
    // API root should NOT detect React Router
    expect(apiRoot!.detectedFrameworks.find((f) => f.id === "react-router-v7")).toBeUndefined();
  });

  it("sets projectRoot correctly per framework", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-mono-"));

    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: ["packages/*"],
    }));
    await mkdir(join(tmpDir, "packages", "web"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "web", "package.json"), JSON.stringify({ name: "web" }));
    await mkdir(join(tmpDir, "packages", "api"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "api", "package.json"), JSON.stringify({ name: "api" }));

    const inventory = makeInventory([
      { path: "packages/web/app/root.tsx" },
      { path: "packages/api/src/server.ts" },
    ]);
    const imports = makeImports([
      { package: "react-router", importedBy: ["packages/web/app/root.tsx"] },
      { package: "express", importedBy: ["packages/api/src/server.ts"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    const rr = result.frameworks.find((f) => f.id === "react-router-v7");
    const express = result.frameworks.find((f) => f.id === "express");

    expect(rr).toBeDefined();
    expect(rr!.projectRoot).toBe("packages/web");

    expect(express).toBeDefined();
    expect(express!.projectRoot).toBe("packages/api");
  });

  it("mixed-language monorepo: Go + TypeScript produce correct per-root results", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-mixed-"));

    // JS workspace for frontend
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: ["packages/*"],
    }));
    await mkdir(join(tmpDir, "packages", "web"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "web", "package.json"), JSON.stringify({ name: "web" }));

    // Go module for backend
    await mkdir(join(tmpDir, "services", "api"), { recursive: true });
    await writeFile(join(tmpDir, "services", "api", "go.mod"), "module example.com/api\n");

    const inventory = makeInventory([
      { path: "packages/web/app/root.tsx" },
      { path: "packages/web/app/routes/home.tsx" },
      { path: "services/api/main.go", language: "Go" },
      { path: "services/api/handlers/user.go", language: "Go" },
    ]);
    const imports = makeImports([
      { package: "react-router", importedBy: ["packages/web/app/root.tsx"] },
      { package: "github.com/go-chi/chi/v5", importedBy: ["services/api/main.go"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    // Should have two roots
    expect(result.roots).toHaveLength(2);

    const webRoot = result.roots.find((r) => r.path === "packages/web");
    const apiRoot = result.roots.find((r) => r.path === "services/api");

    expect(webRoot).toBeDefined();
    expect(apiRoot).toBeDefined();

    // Web root: React Router
    const webRR = webRoot!.detectedFrameworks.find((f) => f.id === "react-router-v7");
    expect(webRR).toBeDefined();
    expect(webRR!.language).toBe("typescript");

    // API root: chi
    const apiChi = apiRoot!.detectedFrameworks.find((f) => f.id === "go-chi");
    expect(apiChi).toBeDefined();
    expect(apiChi!.language).toBe("go");

    // Summary should reflect both languages
    expect(result.summary.byLanguage.typescript).toBeGreaterThanOrEqual(1);
    expect(result.summary.byLanguage.go).toBeGreaterThanOrEqual(1);
  });

  it("config files are scoped to each root directory", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-cfg-"));

    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: ["packages/*"],
    }));
    await mkdir(join(tmpDir, "packages", "web"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "web", "package.json"), JSON.stringify({ name: "web" }));
    // Put next.config.js inside the web root, NOT at project root
    await writeFile(join(tmpDir, "packages", "web", "next.config.js"), "module.exports = {};\n");
    await mkdir(join(tmpDir, "packages", "docs"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "docs", "package.json"), JSON.stringify({ name: "docs" }));

    const inventory = makeInventory([
      { path: "packages/web/app/page.tsx" },
      { path: "packages/docs/src/index.ts" },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    const webRoot = result.roots.find((r) => r.path === "packages/web");
    const docsRoot = result.roots.find((r) => r.path === "packages/docs");

    expect(webRoot).toBeDefined();
    expect(docsRoot).toBeDefined();

    // Web root should detect Next.js via config + file pattern
    const webNext = webRoot!.detectedFrameworks.find((f) => f.id === "nextjs");
    expect(webNext).toBeDefined();
    expect(webNext!.detectedSignals.some((s) => s.kind === "config")).toBe(true);

    // Docs root should NOT detect Next.js (no config file there)
    const docsNext = docsRoot!.detectedFrameworks.find((f) => f.id === "nextjs");
    expect(docsNext).toBeUndefined();
  });

  it("flat frameworks array is the union of all per-root detections", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-union-"));

    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: ["packages/*"],
    }));
    await mkdir(join(tmpDir, "packages", "web"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "web", "package.json"), JSON.stringify({ name: "web" }));
    await mkdir(join(tmpDir, "packages", "api"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "api", "package.json"), JSON.stringify({ name: "api" }));

    const inventory = makeInventory([
      { path: "packages/web/app/root.tsx" },
      { path: "packages/api/src/server.ts" },
    ]);
    const imports = makeImports([
      { package: "react-router", importedBy: ["packages/web/app/root.tsx"] },
      { package: "express", importedBy: ["packages/api/src/server.ts"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    // Flat frameworks array should contain frameworks from both roots
    expect(result.frameworks.find((f) => f.id === "react-router-v7")).toBeDefined();
    expect(result.frameworks.find((f) => f.id === "express")).toBeDefined();

    // Total count should match sum of per-root detections
    const totalPerRoot = result.roots.reduce((sum, r) => sum + r.detectedFrameworks.length, 0);
    expect(result.frameworks.length).toBe(totalPerRoot);
  });

  it("each per-root framework has scoped confidence", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-scope-"));

    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: ["packages/*"],
    }));
    await mkdir(join(tmpDir, "packages", "web"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "web", "package.json"), JSON.stringify({ name: "web" }));
    await writeFile(join(tmpDir, "packages", "web", "next.config.js"), "module.exports = {};\n");

    const inventory = makeInventory([
      { path: "packages/web/app/page.tsx" },
      { path: "packages/web/app/about/page.tsx" },
    ]);
    const imports = makeImports([
      { package: "next", importedBy: ["packages/web/app/page.tsx"] },
    ]);

    const result = analyzeFrameworks(tmpDir, inventory, imports);

    const webRoot = result.roots.find((r) => r.path === "packages/web");
    const nextInRoot = webRoot!.detectedFrameworks.find((f) => f.id === "nextjs");
    expect(nextInRoot).toBeDefined();
    // Should have high confidence: config (0.5) + import (0.45) + file (0.3) + bonus
    expect(nextInRoot!.confidence).toBeGreaterThan(0.8);
  });

  it("empty roots still produce root entries with empty frameworks", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-fw-empty-"));

    await writeFile(join(tmpDir, "package.json"), JSON.stringify({
      name: "monorepo",
      workspaces: ["packages/*"],
    }));
    await mkdir(join(tmpDir, "packages", "utils"), { recursive: true });
    await writeFile(join(tmpDir, "packages", "utils", "package.json"), JSON.stringify({ name: "utils" }));

    // No framework signals in the inventory
    const inventory = makeInventory([{ path: "packages/utils/src/math.ts" }]);

    const result = analyzeFrameworks(tmpDir, inventory, EMPTY_IMPORTS);

    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].path).toBe("packages/utils");
    expect(result.roots[0].detectedFrameworks).toEqual([]);
  });
});
