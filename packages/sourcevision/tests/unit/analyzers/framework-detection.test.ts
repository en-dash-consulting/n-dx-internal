import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeFrameworks, FRAMEWORK_REGISTRY } from "../../../src/analyzers/framework-detection.js";
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
});
