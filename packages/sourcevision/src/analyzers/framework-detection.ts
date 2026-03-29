/**
 * Framework detection — consolidates all implicit framework detection
 * into an explicit registry with confidence scoring.
 *
 * Runs against inventory + import graph data to produce frameworks.json.
 * Detection signals include file patterns, config files, import patterns,
 * and method call patterns.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  Inventory,
  Imports,
  FrameworkRegistryEntry,
  DetectedFramework,
  DetectedFrameworks,
  DetectedFrameworksSummary,
  MatchedSignal,
  FrameworkCategory,
} from "../schema/v1.js";

// ── Framework Registry ──────────────────────────────────────────────────────

/**
 * Static registry of all detectable frameworks.
 * Each entry defines the signals used to identify the framework.
 */
export const FRAMEWORK_REGISTRY: FrameworkRegistryEntry[] = [
  // ── Frontend frameworks ───────────────────────────────────────────
  {
    id: "react-router-v7",
    name: "React Router v7 / Remix",
    category: "frontend",
    language: "typescript",
    detectionSignals: {
      filePatterns: ["app/routes/**/*.tsx", "app/routes/**/*.ts", "src/routes/**/*.tsx"],
      configFiles: ["react-router.config.ts", "react-router.config.js", "remix.config.js", "remix.config.ts"],
      importPatterns: ["react-router", "@remix-run/react", "@remix-run/node", "@remix-run/serve"],
    },
  },
  {
    id: "nextjs",
    name: "Next.js",
    category: "fullstack",
    language: "typescript",
    detectionSignals: {
      filePatterns: ["app/**/page.tsx", "app/**/page.ts", "app/**/page.jsx", "pages/**/*.tsx", "pages/**/*.jsx"],
      configFiles: ["next.config.js", "next.config.mjs", "next.config.ts"],
      importPatterns: ["next", "next/router", "next/navigation", "next/image", "next/link"],
    },
  },
  {
    id: "nuxt",
    name: "Nuxt",
    category: "fullstack",
    language: "typescript",
    detectionSignals: {
      filePatterns: ["pages/**/*.vue", "layouts/**/*.vue", "composables/**/*.ts"],
      configFiles: ["nuxt.config.ts", "nuxt.config.js"],
      importPatterns: ["nuxt", "#imports", "#app"],
    },
  },
  {
    id: "sveltekit",
    name: "SvelteKit",
    category: "fullstack",
    language: "typescript",
    detectionSignals: {
      filePatterns: ["src/routes/**/+page.svelte", "src/routes/**/+layout.svelte", "src/routes/**/+server.ts"],
      configFiles: ["svelte.config.js", "svelte.config.ts"],
      importPatterns: ["@sveltejs/kit", "$app/navigation", "$app/stores"],
    },
  },
  {
    id: "astro",
    name: "Astro",
    category: "frontend",
    language: "typescript",
    detectionSignals: {
      filePatterns: ["src/pages/**/*.astro", "src/layouts/**/*.astro", "src/components/**/*.astro"],
      configFiles: ["astro.config.mjs", "astro.config.ts", "astro.config.js"],
      importPatterns: ["astro", "astro:content", "astro:assets"],
    },
  },

  // ── Backend frameworks (JS/TS) ────────────────────────────────────
  {
    id: "express",
    name: "Express",
    category: "backend",
    language: "typescript",
    detectionSignals: {
      importPatterns: ["express"],
      methodCallPatterns: ["app.get(", "app.post(", "app.put(", "app.delete(", "app.use(", "router.get(", "router.post("],
    },
  },
  {
    id: "hono",
    name: "Hono",
    category: "backend",
    language: "typescript",
    detectionSignals: {
      importPatterns: ["hono"],
      methodCallPatterns: ["app.get(", "app.post(", "app.put(", "app.delete("],
    },
  },
  {
    id: "koa",
    name: "Koa",
    category: "backend",
    language: "typescript",
    detectionSignals: {
      importPatterns: ["koa", "@koa/router"],
      methodCallPatterns: ["router.get(", "router.post(", "router.put(", "router.delete("],
    },
  },

  // ── Backend frameworks (Go) ───────────────────────────────────────
  {
    id: "go-chi",
    name: "chi",
    category: "backend",
    language: "go",
    detectionSignals: {
      importPatterns: ["github.com/go-chi/chi"],
      methodCallPatterns: ["r.Get(", "r.Post(", "r.Put(", "r.Delete(", "r.Patch(", "r.Route(", "r.Group("],
    },
  },
  {
    id: "go-gin",
    name: "gin",
    category: "backend",
    language: "go",
    detectionSignals: {
      importPatterns: ["github.com/gin-gonic/gin"],
      methodCallPatterns: ["router.GET(", "router.POST(", "router.PUT(", "router.DELETE(", "router.PATCH("],
    },
  },
  {
    id: "go-echo",
    name: "echo",
    category: "backend",
    language: "go",
    detectionSignals: {
      importPatterns: ["github.com/labstack/echo"],
      methodCallPatterns: ["e.GET(", "e.POST(", "e.PUT(", "e.DELETE(", "e.PATCH("],
    },
  },
  {
    id: "go-fiber",
    name: "fiber",
    category: "backend",
    language: "go",
    detectionSignals: {
      importPatterns: ["github.com/gofiber/fiber"],
      methodCallPatterns: ["app.Get(", "app.Post(", "app.Put(", "app.Delete(", "app.Patch("],
    },
  },
  {
    id: "go-gorilla-mux",
    name: "gorilla/mux",
    category: "backend",
    language: "go",
    detectionSignals: {
      importPatterns: ["github.com/gorilla/mux"],
      methodCallPatterns: ["HandleFunc(", ".Methods("],
    },
  },
  {
    id: "go-net-http",
    name: "net/http stdlib",
    category: "backend",
    language: "go",
    detectionSignals: {
      importPatterns: ["net/http"],
      methodCallPatterns: ["http.HandleFunc(", "http.Handle(", "http.ListenAndServe("],
    },
  },
];

// ── Simple glob matching ────────────────────────────────────────────────────

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports `**` (any path segments), `*` (any non-separator chars), and `?` (single char).
 */
function globToRegExp(pattern: string): RegExp {
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      // ** matches any number of path segments
      regex += ".*";
      i += 2;
      // Skip trailing slash after **
      if (pattern[i] === "/") i++;
    } else if (ch === "*") {
      // * matches anything except /
      regex += "[^/]*";
      i++;
    } else if (ch === "?") {
      regex += "[^/]";
      i++;
    } else if (ch === ".") {
      regex += "\\.";
      i++;
    } else if (ch === "+") {
      regex += "\\+";
      i++;
    } else {
      regex += ch;
      i++;
    }
  }
  return new RegExp("^" + regex + "$");
}

// ── Detection engine ────────────────────────────────────────────────────────

/** Index for quick file-pattern lookups. */
interface DetectionContext {
  /** All file paths from inventory. */
  filePaths: Set<string>;
  /** External package imports (package -> importing files). */
  externalImports: Map<string, string[]>;
  /** Project root directory (absolute). */
  absDir: string;
}

function buildDetectionContext(
  absDir: string,
  inventory: Inventory,
  imports: Imports,
): DetectionContext {
  const filePaths = new Set(inventory.files.map((f) => f.path));

  const externalImports = new Map<string, string[]>();
  for (const ext of imports.external) {
    externalImports.set(ext.package, ext.importedBy);
  }

  return { filePaths, externalImports, absDir };
}

/**
 * Match file patterns against inventory files using glob matching.
 * Returns matched file paths.
 */
function matchFilePatterns(patterns: string[], filePaths: Set<string>): string[] {
  const matched: string[] = [];
  const seen = new Set<string>();

  const regexes = patterns.map(globToRegExp);

  for (const filePath of filePaths) {
    if (seen.has(filePath)) continue;
    for (const re of regexes) {
      if (re.test(filePath)) {
        matched.push(filePath);
        seen.add(filePath);
        break;
      }
    }
  }

  return matched;
}

/**
 * Match config file patterns by checking file existence on disk.
 * Returns matched config file names.
 */
function matchConfigFiles(configFiles: string[], absDir: string): string[] {
  const matched: string[] = [];
  for (const configFile of configFiles) {
    if (existsSync(join(absDir, configFile))) {
      matched.push(configFile);
    }
  }
  return matched;
}

/**
 * Match import patterns against external imports from the import graph.
 * Returns matched import patterns with the files that import them.
 */
function matchImportPatterns(
  patterns: string[],
  externalImports: Map<string, string[]>,
): Array<{ pattern: string; files: string[] }> {
  const matched: Array<{ pattern: string; files: string[] }> = [];

  for (const pattern of patterns) {
    for (const [pkg, importedBy] of externalImports) {
      if (pkg === pattern || pkg.startsWith(pattern + "/")) {
        matched.push({ pattern: pkg, files: importedBy });
      }
    }
  }

  return matched;
}

/**
 * Compute confidence score based on the number and variety of matched signals.
 *
 * Scoring rules:
 * - Each signal kind contributes a base score
 * - Multiple signal kinds increase confidence (cross-validation)
 * - High (>0.8): multiple signal kinds matched
 * - Medium (0.5-0.8): single signal kind matched
 * - Low (<0.5): weak or heuristic-only match
 */
function computeConfidence(signals: MatchedSignal[]): number {
  if (signals.length === 0) return 0;

  const kinds = new Set(signals.map((s) => s.kind));

  // Base scores per signal kind
  const kindScores: Record<string, number> = {
    config: 0.5,   // Config file is strong evidence
    import: 0.45,  // Import in dependency graph
    file: 0.3,     // File pattern match
    methodCall: 0.25, // Method call pattern (less specific)
  };

  let total = 0;
  for (const kind of kinds) {
    total += kindScores[kind] ?? 0.2;
  }

  // Bonus for cross-validation (multiple signal kinds)
  if (kinds.size >= 3) total += 0.15;
  else if (kinds.size >= 2) total += 0.1;

  return Math.min(1.0, Math.round(total * 100) / 100);
}

/**
 * Detect a single framework against the project context.
 * Returns null if no signals match.
 */
function detectFramework(
  entry: FrameworkRegistryEntry,
  ctx: DetectionContext,
): DetectedFramework | null {
  const signals: MatchedSignal[] = [];
  const ds = entry.detectionSignals;

  // File pattern matching
  if (ds.filePatterns && ds.filePatterns.length > 0) {
    const matched = matchFilePatterns(ds.filePatterns, ctx.filePaths);
    if (matched.length > 0) {
      signals.push({
        kind: "file",
        pattern: ds.filePatterns.join(", "),
        matchedFiles: matched.slice(0, 10),
      });
    }
  }

  // Config file detection
  if (ds.configFiles && ds.configFiles.length > 0) {
    const matched = matchConfigFiles(ds.configFiles, ctx.absDir);
    if (matched.length > 0) {
      signals.push({
        kind: "config",
        pattern: matched.join(", "),
        matchedFiles: matched,
      });
    }
  }

  // Import pattern matching
  if (ds.importPatterns && ds.importPatterns.length > 0) {
    const matched = matchImportPatterns(ds.importPatterns, ctx.externalImports);
    if (matched.length > 0) {
      const allFiles = [...new Set(matched.flatMap((m) => m.files))];
      signals.push({
        kind: "import",
        pattern: matched.map((m) => m.pattern).join(", "),
        matchedFiles: allFiles.slice(0, 10),
      });
    }
  }

  // No signals matched - not detected
  if (signals.length === 0) return null;

  const confidence = computeConfidence(signals);

  return {
    id: entry.id,
    name: entry.name,
    category: entry.category,
    language: entry.language,
    confidence,
    detectedSignals: signals,
    projectRoot: ".",
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface AnalyzeFrameworksOptions {
  /** Override the framework registry (for testing). */
  registry?: FrameworkRegistryEntry[];
}

/**
 * Detect frameworks in a project by scanning inventory and import graph
 * against the framework registry.
 *
 * Returns a DetectedFrameworks result with confidence-scored entries.
 */
export function analyzeFrameworks(
  absDir: string,
  inventory: Inventory,
  imports: Imports,
  options?: AnalyzeFrameworksOptions,
): DetectedFrameworks {
  const registry = options?.registry ?? FRAMEWORK_REGISTRY;
  const ctx = buildDetectionContext(absDir, inventory, imports);
  const detected: DetectedFramework[] = [];

  for (const entry of registry) {
    const result = detectFramework(entry, ctx);
    if (result) {
      detected.push(result);
    }
  }

  // Sort by confidence descending, then by name
  detected.sort((a, b) => {
    const conf = b.confidence - a.confidence;
    if (conf !== 0) return conf;
    return a.name.localeCompare(b.name);
  });

  // Build summary
  const byCategory: Partial<Record<FrameworkCategory, number>> = {};
  const byLanguage: Record<string, number> = {};
  for (const fw of detected) {
    byCategory[fw.category] = (byCategory[fw.category] ?? 0) + 1;
    byLanguage[fw.language] = (byLanguage[fw.language] ?? 0) + 1;
  }

  const summary: DetectedFrameworksSummary = {
    totalDetected: detected.length,
    byCategory,
    byLanguage,
  };

  return { frameworks: detected, summary };
}
