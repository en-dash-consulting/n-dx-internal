# Discovery: Backend & Frontend Coupling Panels in SourceVision UI

**Date:** 2026-03-26
**Branch:** `claude/eager-williams` (Go language integration)
**Status:** Discovery / RFC

## Problem Summary

The SourceVision web dashboard was designed around frontend concepts — Routes, Components, Usage Edges. When analyzing backend projects (Go, Python, Rust), these sections are empty while architecturally rich data (import graphs, hub packages, external dependencies, server routes) has no dedicated UI surface.

The goal is to surface **backend-specific coupling** (database interactions, HTTP handlers, package dependencies) and **frontend-specific coupling** (routes, components, usage edges) as distinct but cohesive views — while preserving the holistic overview for monorepos that span both.

---

## Current State

### UI Structure (9 SourceVision tabs)

| Tab | What it shows | Backend relevance |
|-----|---------------|-------------------|
| **Overview** | Files, LOC, zones, health gauges, languages, circular deps | Universal — works for all projects |
| **Import Graph** | Visual dependency graph | Universal — works for all projects |
| **Zones** | Zone map with cohesion/coupling | Universal — works for all projects |
| **Files** | File inventory with filtering | Universal |
| **Routes** | Route tree, component usage tree, convention coverage, route modules table, most-used components | **Frontend-only** — empty for backend projects |
| **Architecture** | Pattern/relationship findings, zone health bars | Universal but generic |
| **Problems** | Anti-pattern findings | Universal |
| **Suggestions** | Move-file and refactoring suggestions | Universal |
| **PR Markdown** | Auto-generated PR descriptions | Universal |

### Data Already Available (no new analyzers needed)

| Data | Schema type | Source file | Available for Go? |
|------|-------------|-------------|-------------------|
| Internal import edges | `ImportEdge` | `imports.json` | Yes |
| External dependencies | `ExternalImport` (package, importedBy[], symbols[]) | `imports.json` | Yes — with `stdlib`/`third-party`/`internal` kind |
| Most-imported files (fan-in) | `ImportsSummary.mostImported` | `imports.json` | Yes |
| Circular dependencies | `ImportsSummary.circulars` | `imports.json` | Yes |
| Zone findings (hub detection, etc.) | `Finding[]` on `Zones` | `zones.json` | Yes |
| Zone risk metrics | `ZoneRiskMetrics` | `zones.json` | Yes |
| Cross-zone edges | `ZoneCrossing[]` | `zones.json` | Yes |
| Server routes (HTTP endpoints) | `ServerRouteGroup[]` → `ServerRoute[]` | `components.json` | Yes — 6 Go frameworks supported |
| File archetypes | `FileClassification` | `zones.json` (classifications) | Yes — Go-specific signals exist |
| Call graph (functions, fan-in/out) | `FunctionNode[]`, `CallEdge[]`, `CallGraphSummary` | `callgraph.json` | Partial (AST-based, Go support TBD) |
| Primary language | `Manifest.language` | `manifest.json` | Yes |

### Key Observation

The `components.json` file already has `serverRoutes: ServerRouteGroup[]` in the schema, but the Routes view (`routes.ts`) **never renders `serverRoutes`** — it only renders `routeModules`, `routeTree`, `usageEdges`, and `components` (all frontend concepts). Similarly, external dependencies and hub packages are in the data but have no dedicated panel.

---

## Proposed Design

### Approach: Adaptive Panels, Not Separate Dashboards

Rather than creating a "backend mode" and "frontend mode", the UI should **adapt panels based on available data**. The `manifest.language` field and the presence/absence of data (`serverRoutes.length > 0`, `components.length > 0`, etc.) determines what renders.

### Tier 1 — Immediate (data exists, UI changes only)

#### 1A. Server Routes Panel (in Routes view)

**Trigger:** `components.serverRoutes.length > 0`

Render alongside or instead of the frontend route tree:
- Group by prefix (already in `ServerRouteGroup.prefix`)
- Show method badges (GET/POST/PUT/DELETE) with color coding
- File path and handler name
- Total endpoint count in stat grid

**Schema fields used:** `ServerRouteGroup`, `ServerRoute` (method, path, handler, file)

#### 1B. External Dependencies Panel (new section in Architecture or new tab)

**Trigger:** `imports.external.length > 0`

Two sub-sections:
- **Stdlib vs Third-Party breakdown** (for Go: `kind` field on `GoRawImport`)
- **Top packages by importer count** (sorted `external[].importedBy.length`)

Note: The `ExternalImport` schema currently has `package`, `importedBy[]`, and `symbols[]` but does NOT have a `kind` field. The `kind` (stdlib/third-party/internal) is computed in `go-imports.ts` during analysis but isn't persisted to `imports.json`. **This needs a schema addition** to surface stdlib vs third-party in the UI.

**Schema change needed:** Add `kind?: "stdlib" | "third-party" | "internal"` to `ExternalImport`.

#### 1C. Hub Packages Panel (in Architecture view)

**Trigger:** Zone findings contain hub-related findings

Currently hub detection lives in `callgraph-findings.ts` and zone findings as text strings. Surface these as structured cards:
- Package/file name
- Fan-in count (number of importers)
- Consuming zones list

**Schema fields used:** `ImportsSummary.mostImported`, zone `Finding[]`

#### 1D. Package Dependency Flow (in Import Graph or Architecture)

**Trigger:** `imports.edges.length > 0` and project has package/directory structure

Aggregate file-level import edges to package/directory level:
- `apis/` → `core/` → `tools/*` flow visualization
- Sort by fan-in (most-imported packages at top)
- Computed client-side from existing `ImportEdge[]` data

**No schema change needed** — aggregate from existing edges.

### Tier 2 — Near-term (minor analyzer additions)

#### 2A. Database Layer Visibility

Derive database interactions from external import edges:
- Go: imports of `database/sql`, `gorm.io/*`, `go.mongodb.org/*`, etc.
- JS/TS: imports of `pg`, `mysql2`, `mongoose`, `prisma`, `drizzle`, etc.

Requires: A curated list of known DB driver packages mapped to `ExternalImport.package`.

**New analyzer module:** `db-detection.ts` — pattern-match against known DB packages in `external[]`.

#### 2B. API Endpoint Catalog (Go Route Detection Phase 3)

The `go-route-detection.ts` analyzer already exists and supports 6 frameworks. Once wired into the pipeline, `serverRoutes` in `components.json` will populate, and Panel 1A renders them automatically.

**Status:** Analyzer exists, needs pipeline integration.

### Tier 3 — Future (new analyzers needed)

#### 3A. Interface Contracts (Go-specific)

Catalog Go interfaces and their implementations. Useful for understanding abstraction boundaries.

#### 3B. Middleware Chain Visualization

For both Go and JS/TS — show the middleware stack order and what each middleware does.

---

## Monorepo Holistic View

For monorepos with both frontend and backend:

1. **Overview tab stays universal** — it already shows languages, zones, health metrics across the whole project
2. **Routes tab becomes "Endpoints & Components"** — renders both server routes (backend) and component/route-module trees (frontend) in the same view, separated by section headers
3. **Architecture tab gains "Dependencies" section** — external packages, hub files, package flow
4. **No "mode switch" needed** — panels appear/hide based on data presence

### Adaptive Rendering Logic

```
if (serverRoutes.length > 0 && routeModules.length > 0) {
  // Monorepo: show both sections
  render ServerRoutesSection + FrontendRoutesSection
} else if (serverRoutes.length > 0) {
  // Backend project: server routes only
  render ServerRoutesSection
} else if (routeModules.length > 0) {
  // Frontend project: existing behavior
  render FrontendRoutesSection
} else {
  // No route data
  render EmptyState
}
```

---

## Implementation Considerations

### Web Package Zone Impact

New UI code goes in `packages/web/src/viewer/views/`. This is within the `web-viewer` zone. Key governance rules:

- **No new cross-zone imports** — all data flows through existing `external.ts` gateway
- **Schema types** already exported through `external.ts` — `ServerRouteGroup`, `ServerRoute`, `HttpMethod` may need to be added to the re-exports
- **New view files** are fine within `views/` — they follow existing patterns

### Schema Changes Summary

| Change | File | Breaking? |
|--------|------|-----------|
| Add `kind` to `ExternalImport` | `packages/sourcevision/src/schema/v1.ts` | No (optional field) |
| Persist `kind` during Go import analysis | `packages/sourcevision/src/analyzers/go-imports.ts` | No |
| Add `ServerRoute`/`ServerRouteGroup` to viewer external gateway | `packages/web/src/viewer/external.ts` | No |

### Files That Need Modification

| File | Change |
|------|--------|
| `packages/web/src/viewer/views/routes.ts` | Add server routes rendering, rename header adaptively |
| `packages/web/src/viewer/views/architecture.ts` | Add external deps panel, hub packages panel |
| `packages/web/src/viewer/views/overview.ts` | Add server route count to metrics row, external dep count |
| `packages/web/src/viewer/external.ts` | Re-export `ServerRoute`, `ServerRouteGroup`, `HttpMethod`, `ExternalImport` types |
| `packages/sourcevision/src/schema/v1.ts` | Add `kind` to `ExternalImport` |
| `packages/sourcevision/src/analyzers/go-imports.ts` | Persist `kind` on external imports |
| `packages/web/src/viewer/views/sourcevision-tabs.ts` | Potentially rename "Routes" tab label to "Endpoints" or make it adaptive |

### Data Flow (no new data files)

All backend data already lives in the existing 6 data files (`manifest.json`, `inventory.json`, `imports.json`, `zones.json`, `components.json`, `callgraph.json`). No new server routes or data endpoints needed. The viewer fetches the same files and renders new panels from them.

---

## Open Questions

1. **Tab naming:** Should "Routes" become "Endpoints & Components"? Or should we split into separate "Backend" and "Frontend" tabs?
2. **Package-level aggregation:** Should package dependency flow be computed client-side (from import edges) or pre-computed during analysis and stored in a new data structure?
3. **DB detection scope:** Should database layer detection be a first-class analyzer output (stored in schema) or a client-side derivation from external imports?
4. **Archetype-based filtering:** Should file archetypes (route-handler, middleware, service, model) be surfaceable as filters across all views?

---

## Recommended Sequencing

1. **Phase A** (Tier 1A + 1C): Add server routes to Routes view + hub packages to Architecture view — highest impact, lowest effort
2. **Phase B** (Tier 1B): External dependencies panel with stdlib/third-party breakdown — requires one schema addition
3. **Phase C** (Tier 1D): Package dependency flow visualization — client-side computation from existing data
4. **Phase D** (Tier 2A + 2B): Database layer + Go route pipeline integration — requires new analyzer work
5. **Phase E** (Tier 3): Interface contracts + middleware chain — future scope
