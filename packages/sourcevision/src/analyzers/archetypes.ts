/**
 * Built-in archetype definitions for file classification.
 *
 * Archetypes define structural concepts (entry-point, utility, route-handler, etc.)
 * as a stable vocabulary. Each archetype has weighted signals that the classification
 * engine matches against file metadata (path, imports, exports, naming).
 *
 * These consolidate hard-coded patterns previously scattered across:
 * - callgraph-findings.ts (UTILITY_PATH_SEGMENTS, ENTRY_POINT_PATTERNS, etc.)
 * - server-route-detection.ts (route file heuristics)
 * - inventory.ts (test file detection)
 */

import type { ArchetypeDefinition } from "../schema/index.js";

export const BUILTIN_ARCHETYPES: ArchetypeDefinition[] = [
  {
    id: "entrypoint",
    name: "Entry Point",
    description: "Module entry points, public APIs, and CLI entry files where uncalled exports are expected.",
    signals: [
      { kind: "filename", pattern: "^index\\.[tj]sx?$", weight: 0.8 },
      { kind: "filename", pattern: "^main\\.[tj]sx?$", weight: 0.8 },
      { kind: "filename", pattern: "^cli\\.[tj]sx?$", weight: 0.8 },
      { kind: "filename", pattern: "^public\\.[tj]sx?$", weight: 0.9 },
      { kind: "filename", pattern: "^mod\\.[tj]sx?$", weight: 0.7 },
    ],
    analysisHints: {
      deadExports: "skip",
      description: "Uncalled exports are expected in entry points",
    },
  },
  {
    id: "utility",
    name: "Utility",
    description: "Shared utility, helper, and infrastructure modules where high fan-in is expected.",
    signals: [
      { kind: "directory", pattern: "/core/", weight: 0.7 },
      { kind: "directory", pattern: "/utils/", weight: 0.8 },
      { kind: "directory", pattern: "/helpers/", weight: 0.8 },
      { kind: "directory", pattern: "/lib/", weight: 0.6 },
      { kind: "filename", pattern: "^output\\.[tj]sx?$", weight: 0.7 },
      { kind: "filename", pattern: "^logger\\.[tj]sx?$", weight: 0.7 },
      { kind: "filename", pattern: "^logging\\.[tj]sx?$", weight: 0.7 },
      { kind: "filename", pattern: "^errors\\.[tj]sx?$", weight: 0.7 },
    ],
    analysisHints: {
      hubThresholdMultiplier: "2",
      hotspotThresholdMultiplier: "2",
      description: "High fan-in is expected for utility modules",
    },
  },
  {
    id: "types",
    name: "Types & Constants",
    description: "Type definitions, constants, and enums — companion files, not logic.",
    signals: [
      { kind: "filename", pattern: "^types\\.[tj]sx?$", weight: 0.9 },
      { kind: "filename", pattern: "^constants\\.[tj]sx?$", weight: 0.9 },
      { kind: "filename", pattern: "^enums\\.[tj]sx?$", weight: 0.9 },
      { kind: "filename", pattern: "\\.types\\.[tj]sx?$", weight: 0.9 },
      { kind: "filename", pattern: "\\.constants\\.[tj]sx?$", weight: 0.9 },
      { kind: "filename", pattern: "\\.d\\.ts$", weight: 0.9 },
    ],
    analysisHints: {
      couplingExpectation: "unidirectional",
      deadExports: "skip",
      description: "Unidirectional coupling is expected for type files",
    },
  },
  {
    id: "route-handler",
    name: "Route Handler",
    description: "Server-side HTTP route handlers (Express, Hono, Koa, etc.).",
    signals: [
      { kind: "filename", pattern: "^routes?[-.]", weight: 0.8 },
      { kind: "filename", pattern: "^router\\.[tj]sx?$", weight: 0.8 },
      { kind: "directory", pattern: "/routes/", weight: 0.7 },
      { kind: "directory", pattern: "/api/", weight: 0.6 },
    ],
    analysisHints: {
      description: "Server-side route handlers",
    },
  },
  {
    id: "route-module",
    name: "Route Module",
    description: "Framework convention route modules (Remix/React Router) with loader/action/default exports.",
    signals: [
      { kind: "export", pattern: "^(loader|action|default|meta|links|headers|ErrorBoundary)$", weight: 0.8 },
    ],
    analysisHints: {
      deadExports: "skip",
      description: "Convention exports are expected in route modules",
    },
  },
  {
    id: "component",
    name: "Component",
    description: "React/UI component files with JSX-returning functions.",
    signals: [
      { kind: "filename", pattern: "\\.[tj]sx$", weight: 0.4 },
      { kind: "directory", pattern: "/components/", weight: 0.6 },
      { kind: "directory", pattern: "/ui/", weight: 0.5 },
    ],
    analysisHints: {
      description: "UI component files",
    },
  },
  {
    id: "store",
    name: "Store",
    description: "State management stores and slices.",
    signals: [
      { kind: "directory", pattern: "/store/", weight: 0.8 },
      { kind: "directory", pattern: "/stores/", weight: 0.8 },
      { kind: "filename", pattern: "\\.store\\.[tj]sx?$", weight: 0.9 },
      { kind: "filename", pattern: "\\.slice\\.[tj]sx?$", weight: 0.9 },
    ],
    analysisHints: {
      description: "State management modules",
    },
  },
  {
    id: "middleware",
    name: "Middleware",
    description: "Request/response middleware in server frameworks.",
    signals: [
      { kind: "directory", pattern: "/middleware/", weight: 0.8 },
      { kind: "directory", pattern: "/middlewares/", weight: 0.8 },
      { kind: "filename", pattern: "\\.middleware\\.[tj]sx?$", weight: 0.9 },
    ],
    analysisHints: {
      description: "Middleware modules",
    },
  },
  {
    id: "model",
    name: "Model",
    description: "Data models, schemas, and ORM definitions.",
    signals: [
      { kind: "directory", pattern: "/models/", weight: 0.8 },
      { kind: "filename", pattern: "\\.model\\.[tj]sx?$", weight: 0.9 },
      { kind: "filename", pattern: "\\.schema\\.[tj]sx?$", weight: 0.8 },
    ],
    analysisHints: {
      description: "Data model definitions",
    },
  },
  {
    id: "gateway",
    name: "Gateway",
    description: "Re-export-heavy gateway modules that concentrate cross-package imports.",
    signals: [
      { kind: "filename", pattern: "^(?:deps|gateway|barrel)\\.[tj]sx?$", weight: 0.7 },
    ],
    analysisHints: {
      deadExports: "skip",
      description: "Gateway modules are expected to re-export heavily",
    },
  },
  {
    id: "config",
    name: "Config",
    description: "Configuration files and settings modules.",
    signals: [
      { kind: "filename", pattern: "^config\\.[tj]sx?$", weight: 0.7 },
      { kind: "filename", pattern: "\\.config\\.[tj]sx?$", weight: 0.8 },
      { kind: "directory", pattern: "/config/", weight: 0.6 },
    ],
    analysisHints: {
      deadExports: "skip",
      description: "Config modules may have unused exports consumed at runtime",
    },
  },
  {
    id: "test-helper",
    name: "Test Helper",
    description: "Test utilities, fixtures, and mocks.",
    signals: [
      { kind: "directory", pattern: "/fixtures/", weight: 0.8 },
      { kind: "directory", pattern: "/mocks/", weight: 0.8 },
      { kind: "directory", pattern: "/__mocks__/", weight: 0.9 },
      { kind: "directory", pattern: "/__fixtures__/", weight: 0.9 },
      { kind: "filename", pattern: "^test-utils\\.[tj]sx?$", weight: 0.8 },
      { kind: "filename", pattern: "^test-helpers\\.[tj]sx?$", weight: 0.8 },
      { kind: "filename", pattern: "^setup\\.[tj]sx?$", weight: 0.5 },
    ],
    analysisHints: {
      description: "Test utility files",
    },
  },
];

/**
 * Build a lookup map from archetype ID to definition.
 */
export function buildArchetypeMap(
  archetypes: ArchetypeDefinition[]
): Map<string, ArchetypeDefinition> {
  return new Map(archetypes.map((a) => [a.id, a]));
}
