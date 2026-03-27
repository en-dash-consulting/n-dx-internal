# Implementation Plan: Backend & Frontend Coupling Panels in SourceVision UI

**Date:** 2026-03-26
**Branch:** `claude/eager-williams` (Go language integration)
**Discovery:** [backend-frontend-ui-discovery.md](./backend-frontend-ui-discovery.md)

## Context

The SourceVision dashboard was designed around frontend concepts (Routes, Components, Usage Edges). When analyzing backend projects (Go, Python, Rust), these panels are empty while architecturally rich data — import graphs, hub packages, external dependencies, server routes — already exists in the analysis output but has no dedicated UI surface.

This plan adds adaptive panels that render backend-specific and frontend-specific coupling data based on what's available, while preserving the holistic overview for monorepos.

## Approach: Adaptive Rendering

No "mode switch" — panels appear/hide based on data presence. The `manifest.language` field and data availability (`serverRoutes.length > 0`, `components.length > 0`, etc.) drive what renders.

---

## Phase A: Server Routes Panel + Hub Packages (highest impact, lowest effort)

### Step 1: Add missing types to viewer gateway

**File:** `packages/web/src/viewer/external.ts`

Add `ServerRoute`, `ServerRouteGroup`, `HttpMethod` to the schema type re-exports (line 13-29). These types exist in the schema but aren't currently re-exported for viewer consumption.

### Step 2: Add Server Routes section to Routes view

**File:** `packages/web/src/viewer/views/routes.ts`

Current state: The view renders `routeModules`, `routeTree`, `usageEdges`, `components` — all frontend concepts. It completely ignores `components.serverRoutes` despite it being populated by the analyzer pipeline.

Changes:
- Read `serverRoutes` from `components` (already in the data, just unused)
- Add a "Server Endpoints" section before the frontend route tree
- Render routes grouped by file/prefix with HTTP method badges (GET=blue, POST=green, PUT=orange, DELETE=red)
- Use existing `CollapsibleSection` for the table wrapper
- Use existing `.data-table` styling for the route table
- Add HTTP method badge CSS classes to `packages/web/src/viewer/styles/routes.css` following the `.route-badge-*` pattern

Layout of new section:
```
[Method Badge] [Path]  [Handler]  [File]
  GET          /api/users  listUsers  cmd/api/router.go
  POST         /api/users  createUser cmd/api/router.go
```

- Add `totalServerRoutes` to the stat grid (currently shows Components, Route Modules, Usage Edges, Layout Depth — add Server Endpoints when > 0)

### Step 3: Make Routes view header adaptive

**File:** `packages/web/src/viewer/views/routes.ts`

```
if (hasServerRoutes && hasFrontendRoutes) → "Endpoints & Components"
if (hasServerRoutes && !hasFrontendRoutes) → "Server Endpoints"
if (!hasServerRoutes && hasFrontendRoutes) → "Routes & Components" (current)
```

Also update the empty state message to be language-aware.

### Step 4: Add Hub Packages section to Architecture view

**File:** `packages/web/src/viewer/views/architecture.ts`

Current state: Shows patterns, relationships, zone health bars. Hub information is buried in finding text strings.

Changes:
- Extract hub-related findings from `zones.findings` (filter by text containing "hub" or "fan-in")
- Also use `imports.summary.mostImported` to show top fan-in files as a ranked list
- Add a "Hub Files" section with a `BarChart` showing top files by import count
- Use existing `BarChart` component (already imported in architecture.ts)

### Step 5: Update Overview with server route count

**File:** `packages/web/src/viewer/views/overview.ts`

Add a "Server Endpoints" MetricCard to the metrics row when `components?.summary.totalServerRoutes > 0`. Uses existing `MetricCard` component.

---

## Phase B: External Dependencies Panel (one schema change)

### Step 6: Add `kind` field to `ExternalImport` schema

**File:** `packages/sourcevision/src/schema/v1.ts` (line 119-123)

Add optional `kind` field:
```typescript
export interface ExternalImport {
  package: string;
  importedBy: string[];
  symbols: string[];
  kind?: "stdlib" | "third-party";
}
```

### Step 7: Persist `kind` in Go import analyzer

**File:** `packages/sourcevision/src/analyzers/go-imports.ts` (line 227-239)

Currently the `kind` is used to prefix package names with `"stdlib:"` but isn't stored as a structured field. Change to also set `kind` on the `ExternalImport` object:

```typescript
// Line 234: add kind to the ExternalImport object
externalMap.set(pkg, {
  package: pkg,
  importedBy: [filePath],
  symbols: ["*"],
  kind: imp.kind === "stdlib" ? "stdlib" : "third-party",
});
```

### Step 8: Add External Dependencies section to Architecture view

**File:** `packages/web/src/viewer/views/architecture.ts`

Add after the Hub Files section:
- "External Dependencies" heading
- Two sub-sections when `kind` data is available:
  - **Standard Library** — stdlib packages sorted by importer count
  - **Third-Party** — third-party packages sorted by importer count
- When `kind` is not available (TS/JS projects), show a single sorted list
- Use `BarChart` for top-N visualization
- Use `CollapsibleSection` + `.data-table` for full list
- Show total external count in Architecture stat grid

For Go projects, detect stdlib by checking `package.startsWith("stdlib:")` (existing convention) as a fallback when `kind` is absent (backward compat with existing analysis output).

### Step 9: Update Overview with external dependency count

**File:** `packages/web/src/viewer/views/overview.ts`

Add "External Deps" MetricCard when `imports?.summary.totalExternal > 0`.

---

## Phase C: Package Dependency Flow (client-side aggregation)

### Step 10: Add package-level dependency aggregation utility

**File:** `packages/web/src/viewer/views/routes.ts` (or a new helper within the views directory)

Compute package-level (directory-level) dependencies by aggregating `ImportEdge[]`:
- Group edges by first N directory segments (e.g., `packages/rex/src/core/` → `core`)
- Deduplicate to get unique package→package edges with weight (edge count)
- Sort packages by fan-in count

This is a `useMemo` computation inside the view — no new data files needed.

### Step 11: Add Package Flow visualization to Architecture view

**File:** `packages/web/src/viewer/views/architecture.ts`

Add a "Package Dependencies" section using the existing `FlowDiagram` component:
- Nodes = top-level packages/directories
- Edges = aggregated import edges between packages
- Weight = number of file-level edges
- Color = zone color if packages map to zones

Use `buildFlowNodes` and `buildFlowEdges` helpers from `packages/web/src/viewer/visualization/flow.ts` if applicable, or compute directly.

---

## Files Modified (Summary)

| File | Phase | Change |
|------|-------|--------|
| `packages/web/src/viewer/external.ts` | A | Add `ServerRoute`, `ServerRouteGroup`, `HttpMethod` type re-exports |
| `packages/web/src/viewer/views/routes.ts` | A | Add server routes section, adaptive header, adaptive stat grid |
| `packages/web/src/viewer/styles/routes.css` | A | Add HTTP method badge CSS classes |
| `packages/web/src/viewer/views/architecture.ts` | A,B,C | Add hub files, external deps, package flow sections |
| `packages/web/src/viewer/views/overview.ts` | A,B | Add server endpoints + external deps metric cards |
| `packages/sourcevision/src/schema/v1.ts` | B | Add `kind` to `ExternalImport` |
| `packages/sourcevision/src/analyzers/go-imports.ts` | B | Persist `kind` on external imports |

## Existing Components Reused

| Component | File | Used for |
|-----------|------|----------|
| `CollapsibleSection` | `components/data-display/collapsible-section.ts` | Table wrappers |
| `BarChart` | `components/data-display/mini-charts.ts` | Hub files, external deps ranked lists |
| `FlowDiagram` | `components/data-display/mini-charts.ts` | Package dependency flow |
| `MetricCard` | `components/data-display/health-gauge.ts` | Overview stat cards |
| `SearchFilter` | `components/search-filter.ts` | Server routes filtering |
| `TreeView` | `components/data-display/tree-view.ts` | Package dependency tree (alternative to flow) |
| `.route-badge-*` pattern | `styles/routes.css` | HTTP method badge styling |
| `.data-table` | `styles/tables.css` | Route table rendering |
| `.stat-grid` / `.stat-card` | `styles/cards.css` | Stat grid layout |

## Verification

1. **Build:** `pnpm build` — ensure no type errors from schema change or new imports
2. **Unit tests:** `pnpm test --filter=sourcevision` — verify schema validation still passes, go-imports persists kind
3. **Visual verification:**
   - Run `ndx start .` against a Go project (e.g., PocketBase fixture) — server routes should appear in Routes view
   - Run against a frontend project — existing behavior preserved, no regressions
   - Run against this monorepo (mixed) — both server routes and frontend routes visible
4. **Boundary tests:** `pnpm test --filter=web` — boundary-check.test.ts should pass (gateway imports are compliant)
5. **Architecture policy:** `node tests/e2e/architecture-policy.test.js` — no zone violations from new code
