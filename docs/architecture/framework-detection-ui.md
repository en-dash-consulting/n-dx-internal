# Framework Detection & Dynamic Dashboard Pages

## Overview

SourceVision's framework detection module (internal phase 8, CLI `--phase=8`) scans inventory and import graph data to identify languages, web frameworks, and runtime stacks. Its output gates dashboard tab visibility and populates the "Technology Stack" section on the Overview page.

Framework detection is grouped into **UI Phase 1 (Scan)** alongside inventory, imports, and config surface. It runs last in the group since it depends on inventory + imports output. It is free (no LLM calls) and fast.

## Phase Mapping

| UI Phase | Name | Internal Phases | Modules |
|----------|------|-----------------|---------|
| **1** | **Scan** | 1, 2, 7, 8 | inventory, imports, configsurface, **frameworks** |
| 2 | Classify | 3, 5 | classifications, components |
| 3 | Architecture | 4, 6 | zones, callgraph |
| 4 | Deep Analysis | 4 (--full) | zone enrichment passes 2-4, meta-eval |

## Detection Pipeline

```
inventory.json + imports.json
        ↓
  FRAMEWORK_REGISTRY (static rules)
        ↓
  Signal matching: filePatterns, configFiles, importPatterns, methodCallPatterns
        ↓
  Confidence scoring (config: 0.5, import: 0.45, file: 0.3, methodCall: 0.25)
        ↓
  Cross-validation bonus (+0.1 for 2 signal kinds, +0.15 for 3+)
        ↓
  frameworks.json
```

**Key constraint:** `node:*` builtins are filtered by the imports analyzer (`imports.ts:497`) and never appear in `imports.json`. Frameworks that use only Node.js builtins (e.g., raw `node:http`) must be detected via `methodCallPatterns` or `filePatterns`, not `importPatterns`.

## Registered Frameworks

| ID | Name | Category | Language | Detection Signals |
|----|------|----------|----------|-------------------|
| `react-router-v7` | React Router v7 / Remix | frontend | TypeScript | files, config, imports |
| `nextjs` | Next.js | fullstack | TypeScript | files, config, imports |
| `nuxt` | Nuxt | fullstack | TypeScript | files, config, imports |
| `sveltekit` | SvelteKit | fullstack | TypeScript | files, config, imports |
| `astro` | Astro | frontend | TypeScript | files, config, imports |
| `express` | Express | backend | TypeScript | imports, methodCalls |
| `hono` | Hono | backend | TypeScript | imports, methodCalls |
| `koa` | Koa | backend | TypeScript | imports, methodCalls |
| `go-chi` | chi | backend | Go | imports, methodCalls |
| `go-gin` | gin | backend | Go | imports, methodCalls |
| `go-echo` | echo | backend | Go | imports, methodCalls |
| `go-fiber` | fiber | backend | Go | imports, methodCalls |
| `go-gorilla-mux` | gorilla/mux | backend | Go | imports, methodCalls |
| `go-net-http` | net/http stdlib | backend | Go | imports, methodCalls |

## Dashboard Pages Using Framework Data

### Overview — Technology Stack Section

**File:** `packages/web/src/viewer/views/overview.ts:344-385`
**Framework gated:** No (section always renders; shows "No frameworks detected" when empty)

Displays detected frameworks as badges grouped by:
- **Project root** (for monorepo multi-root support)
- **Category** (frontend, backend, fullstack) within each root

Each badge shows:
- Framework name and language
- Confidence level badge (high >= 0.8, medium >= 0.5, low < 0.5)
- Clickable to navigate to Files view filtered by that root

### Endpoints Tab

**File:** `packages/web/src/viewer/views/sv-endpoints.ts`
**Framework gated:** Yes — `requiredCategory: "backend"` with confidence >= 0.5

Only visible when a backend or fullstack framework is detected. Displays:
- HTTP method distribution chart
- Endpoint details table: Method, Path, File, Zone, Handler
- Route modules table: File, Pattern, Exports, Layout, Index, Parent Layout
- Most-used components table: Component, Kind, File, Usage Count

### Routes Tab

**File:** `packages/web/src/viewer/views/routes.ts`
**Framework gated:** No (always visible)

Title adapts based on detected content:
- "Routes & Components" — client routes only
- "Routes, Endpoints & Components" — both client + server routes
- "Server Endpoints & Components" — server-only (no client routing framework)

## Data Flow

```
.sourcevision/frameworks.json
        ↓
GET /api/sv/frameworks  (routes-sourcevision.ts)
        ↓
Viewer fetches at startup  (loader.ts)
        ↓
getVisibleTabs(frameworks)  (sourcevision-tabs.ts)
        ↓
Sidebar renders visible tabs  (sidebar.ts)
        ↓
Overview renders Technology Stack badges  (overview.ts)
```

## Tab Visibility Configuration

**File:** `packages/web/src/viewer/views/sourcevision-tabs.ts`

| Tab | `requiredFramework` | `requiredCategory` | Always Visible |
|-----|--------------------|--------------------|----------------|
| Overview | — | — | Yes |
| Explorer | — | — | Yes |
| Zones | — | — | Yes |
| Endpoints | — | `"backend"` | No |
| Analysis | — | — | Yes (minPass gated) |

**Default confidence threshold:** 0.5 (configurable via `getVisibleTabs()` second parameter)

**Graceful degradation:** When `frameworks` is null (not yet loaded or Phase 1 hasn't run), all tabs show to avoid hiding content during initial load.
