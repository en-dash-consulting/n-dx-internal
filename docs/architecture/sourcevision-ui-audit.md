# SourceVision UI Audit — Data Visualization Gap Analysis & Route Reorganization

**Date:** 2026-03-27
**Branch:** `feature/sourcevision-ui-backend-display`
**Scope:** Complete inventory of sourcevision scan cycle outputs vs. current dashboard visualization coverage, plus UI route reorganization recommendations

---

## 1. Executive Summary

The SourceVision analysis engine produces **6 core data files**, **3 supplementary files**, and **optional per-zone/historical outputs** totaling **110+ distinct data fields** across inventory, dependency graph, file classification, architectural zones, component/route detection, and function call graph domains.

The current web dashboard surfaces approximately **41% of available data** (45 of 110 fields). Two entire datasets — **Classifications/Archetypes** (13 fields) and **Call Graph** (17 fields) — have **0% coverage**. The remaining gaps represent actionable architectural intelligence that is computed and persisted but never presented to the user.

Beyond data gaps, the current 9-tab SourceVision navigation has structural issues: tabs mix abstraction levels (raw data alongside synthesized insights), the enrichment-gating system hides high-value views behind AI pass thresholds, and the route organization doesn't guide users through a coherent analytical workflow.

This audit catalogs every data field, maps it to its current UI consumer (if any), identifies visualization gaps ranked by user impact, proposes a reorganized route structure for increased focus and clarity, and identifies a new data collection opportunity: **environment variables, config items, and global constants** — the invisible configuration surface that drives runtime behavior but is currently unscanned.

---

## 2. Analysis Methodology

1. Traced the `sourcevision analyze` command through all 6 phases (`analyze-phases.ts`) to catalog every output file and its schema
2. Read the complete schema definition (`packages/sourcevision/src/schema/v1.ts`) to enumerate all TypeScript interfaces
3. Inspected real output from a Go backend project (`.sourcevision/`) to validate field population
4. Audited every web dashboard view file (`packages/web/src/viewer/views/*.ts`) to map data consumption
5. Cross-referenced server API endpoints (`routes-sourcevision.ts`, `routes-data.ts`) against view data requirements
6. Compared MCP tool outputs (`mcp.ts`) against dashboard coverage
7. Mapped the full view registry (`view-registry.ts`) and navigation structure (`sourcevision-tabs.ts`) for route analysis

---

## 3. Complete Data Inventory

### 3.1 Phase 1 — `inventory.json` (File Catalog)

| Field | Type | Description | UI Status |
|-------|------|-------------|-----------|
| `files[].path` | string | Relative file path | ✅ Files view |
| `files[].size` | number | Byte size | ✅ Files view (sortable column) |
| `files[].language` | string | Detected language | ✅ Files view + Overview bar chart |
| `files[].lineCount` | number | Lines of code | ✅ Files view (sortable column) |
| `files[].hash` | string | Content hash for incremental analysis | ⬜ Internal use only (expected) |
| `files[].role` | enum | source \| test \| config \| docs \| generated \| asset \| build \| other | ✅ Files view (filter + column) |
| `files[].category` | string | Semantic category | ✅ Files view (filter + column) |
| `files[].lastModified` | string | ISO timestamp | ❌ Not displayed |
| `summary.totalFiles` | number | Aggregate file count | ✅ Overview metric card |
| `summary.totalLines` | number | Aggregate line count | ✅ Overview metric card |
| `summary.byLanguage` | Record | Language distribution | ✅ Overview bar chart |
| `summary.byRole` | Record | Role distribution | ❌ Not displayed as chart |
| `summary.byCategory` | Record | Category distribution | ❌ Not displayed as chart |

**Coverage: 9/13 fields surfaced (69%)**

### 3.2 Phase 2 — `imports.json` (Dependency Graph)

| Field | Type | Description | UI Status |
|-------|------|-------------|-----------|
| `edges[].from` | string | Source file path | ✅ Graph view (edge rendering) |
| `edges[].to` | string | Target file/package | ✅ Graph view (edge rendering) |
| `edges[].type` | enum | static \| dynamic \| require \| reexport \| type | ❌ Not differentiated visually |
| `edges[].symbols[]` | string[] | Imported symbol names | ❌ Not displayed anywhere |
| `external[].package` | string | External package name | ✅ Architecture view (bar chart + table) |
| `external[].importedBy[]` | string[] | Files importing this package | ✅ Architecture view (count shown) |
| `external[].symbols[]` | string[] | Used symbols from package | ❌ Not displayed |
| `external[].kind` | enum | stdlib \| third-party (Go only) | ✅ Architecture view (separated sections) |
| `summary.totalEdges` | number | Total import edge count | ⚠️ Implicit in graph, not as metric |
| `summary.totalExternal` | number | External package count | ⚠️ Implicit in architecture, not as metric |
| `summary.circularCount` | number | Circular dependency count | ✅ Overview metric card |
| `summary.circulars[]` | array | Cycle file paths | ✅ Overview (list) |
| `summary.mostImported[]` | array | Hub files by import count | ✅ Architecture view (bar chart) |
| `summary.avgImportsPerFile` | number | Import density metric | ❌ Not displayed |

**Coverage: 8/14 fields surfaced (57%)**

### 3.3 Phase 3 — `classifications.json` (File Archetypes)

| Field | Type | Description | UI Status |
|-------|------|-------------|-----------|
| `archetypes[].id` | string | Archetype identifier | ❌ Not displayed |
| `archetypes[].name` | string | Human-readable archetype name | ❌ Not displayed |
| `archetypes[].description` | string | What this archetype represents | ❌ Not displayed |
| `archetypes[].signals[]` | array | Detection signal patterns with weights | ❌ Not displayed |
| `files[].archetype` | string \| null | Assigned archetype ID | ❌ Not in Files view (only role/category shown) |
| `files[].secondaryArchetypes[]` | string[] | Additional classifications | ❌ Not displayed |
| `files[].confidence` | number | Classification confidence score | ❌ Not displayed |
| `files[].source` | enum | algorithmic \| llm \| user-override | ❌ Not displayed |
| `files[].evidence[]` | array | Signal matches with weights | ❌ Not displayed |
| `summary.totalClassified` | number | Files with archetype assigned | ❌ Not displayed |
| `summary.totalUnclassified` | number | Files without archetype | ❌ Not displayed |
| `summary.byArchetype` | Record | Archetype distribution | ❌ Not displayed |
| `summary.bySource` | Record | Classification method distribution | ❌ Not displayed |

**Coverage: 0/13 fields surfaced (0%) — Entire dataset invisible in the UI**

### 3.4 Phase 4 — `zones.json` (Architectural Zones)

| Field | Type | Description | UI Status |
|-------|------|-------------|-----------|
| `zones[].id` | string | Zone identifier | ✅ Zones view |
| `zones[].name` | string | Zone display name | ✅ Zones view + Overview |
| `zones[].description` | string | Zone purpose description | ✅ Zones view (slideout) |
| `zones[].files[]` | string[] | Member file paths | ✅ Zones view (file rows) |
| `zones[].entryPoints[]` | string[] | Public API surface files | ❌ Not highlighted in any view |
| `zones[].cohesion` | number | Internal edge ratio (0–1) | ✅ Overview gauge + Zones view |
| `zones[].coupling` | number | External edge ratio (0–1) | ✅ Overview gauge + Zones view |
| `zones[].riskMetrics.riskScore` | number | Composite risk score | ⚠️ Used internally, not displayed as metric |
| `zones[].riskMetrics.riskLevel` | enum | healthy \| at-risk \| critical \| catastrophic | ⚠️ Implied by color, not labeled |
| `zones[].riskMetrics.failsThreshold` | boolean | Whether zone fails policy threshold | ❌ Not displayed |
| `zones[].riskMetrics.riskJustification` | string | AI explanation of risk | ❌ Not displayed |
| `zones[].detectionQuality` | enum | genuine \| artifact \| residual | ❌ Not displayed |
| `zones[].subZones[]` | Zone[] | Nested zone hierarchy | ✅ Zones view (drill-down) |
| `zones[].insights[]` | string[] | Legacy text observations | ✅ Legacy fallback in problems/suggestions |
| `crossings[].from/to` | string | Boundary crossing file paths | ✅ Zones view (edge rendering) |
| `crossings[].fromZone/toZone` | string | Zone identifiers for crossings | ✅ Zones view |
| `findings[].type` | enum | observation \| pattern \| relationship \| anti-pattern \| suggestion \| move-file | ✅ Split across Architecture/Problems/Suggestions |
| `findings[].severity` | enum | critical \| warning \| info | ✅ Problems view (severity counts) |
| `findings[].text` | string | Finding description | ✅ All findings views |
| `findings[].scope` | string | global or zone ID | ✅ Suggestions view (global vs zone) |
| `findings[].related[]` | string[] | Related zone/file references | ❌ Not displayed as links |
| `enrichmentPass` | number | Current AI enrichment level | ✅ Used for view gating |
| `metaEvaluationCount` | number | Meta-evaluation iterations | ❌ Not displayed |
| `structureHash` | string | Zone structure fingerprint | ⬜ Internal use only (expected) |

**Coverage: 15/24 fields surfaced (63%)**

### 3.5 Phase 5 — `components.json` (UI Components & Routes)

| Field | Type | Description | UI Status |
|-------|------|-------------|-----------|
| `components[].file` | string | Component file path | ✅ Routes view |
| `components[].name` | string | Component name | ✅ Routes view |
| `components[].kind` | enum | function \| arrow \| class \| forwardRef | ❌ Not displayed |
| `components[].line` | number | Definition line number | ❌ Not displayed |
| `components[].isDefaultExport` | boolean | Whether default exported | ❌ Not displayed |
| `usageEdges[].from/to` | string | Component usage relationships | ✅ Routes view (usage tree) |
| `usageEdges[].componentName` | string | Which component is used | ✅ Routes view |
| `usageEdges[].usageCount` | number | How many times used | ❌ Not displayed |
| `routeModules[].file` | string | Route module file | ✅ Routes view (tree) |
| `routeModules[].routePattern` | string | URL pattern | ✅ Routes view |
| `routeModules[].exports[]` | enum[] | loader \| action \| default \| meta \| etc. | ❌ Not displayed |
| `routeModules[].parentLayout` | string | Parent layout file | ❌ Not displayed |
| `routeModules[].isLayout/isIndex` | boolean | Layout/index markers | ❌ Not displayed |
| `routeTree[]` | recursive | Hierarchical route structure | ✅ Routes view |
| `serverRoutes[].file` | string | Handler file | ✅ Routes view + Architecture |
| `serverRoutes[].method` | enum | HTTP method | ✅ Routes view (method chart) |
| `serverRoutes[].path` | string | Endpoint path | ✅ Routes view |
| `serverRoutes[].handler` | string | Handler function name | ❌ Not displayed |
| `summary.totalComponents` | number | Component count | ⚠️ Routes view header only |
| `summary.totalServerRoutes` | number | Server route count | ✅ Overview metric |
| `summary.mostUsedComponents[]` | array | Components by usage frequency | ❌ Not displayed |
| `summary.layoutDepth` | number | Max route nesting depth | ❌ Not displayed |

**Coverage: 11/22 fields surfaced (50%)**

### 3.6 Phase 6 — `callgraph.json` (Function Call Graph)

| Field | Type | Description | UI Status |
|-------|------|-------------|-----------|
| `functions[].file` | string | Function definition file | ⚠️ Passed to zones view only |
| `functions[].name` | string | Function name | ⚠️ Passed to zones view only |
| `functions[].qualifiedName` | string | Class.method qualified name | ❌ Not displayed |
| `functions[].line` | number | Definition line | ❌ Not displayed |
| `functions[].isExported` | boolean | Whether exported | ❌ Not displayed |
| `edges[].callerFile` | string | Calling file | ⚠️ Zone edge weighting only |
| `edges[].caller` | string | Calling function qualified name | ❌ Not displayed |
| `edges[].calleeFile` | string \| null | Called file (null if external) | ⚠️ Zone edge weighting only |
| `edges[].callee` | string | Called function name | ❌ Not displayed |
| `edges[].type` | enum | direct \| method \| property-chain \| computed | ❌ Not displayed |
| `edges[].line/column` | number | Call site location | ❌ Not displayed |
| `summary.totalFunctions` | number | Total function count | ❌ Not displayed |
| `summary.totalCalls` | number | Total call edge count | ❌ Not displayed |
| `summary.filesWithCalls` | number | Files with call data | ❌ Not displayed |
| `summary.mostCalled[]` | array | Hotspot functions by caller count | ❌ Not displayed |
| `summary.mostCalling[]` | array | Most complex functions by callee count | ❌ Not displayed |
| `summary.cycleCount` | number | Call graph cycles | ❌ Not displayed |

**Coverage: 0/17 fields directly surfaced (0%) — Used only as input to zone edge weighting**

### 3.7 Supplementary Files

| File | Key Content | UI Status |
|------|-------------|-----------|
| `manifest.json` | Analysis metadata, phase status, git context | ✅ Overview (git info, timestamp) |
| `manifest.tokenUsage` | LLM token consumption | ⚠️ Feature-gated view only |
| `manifest.language` | Primary detected language | ❌ Not displayed |
| `manifest.languages[]` | All detected languages by prevalence | ❌ Not displayed |
| `CONTEXT.md` | AI-optimized architecture summary | ❌ Not shown in dashboard |
| `llms.txt` | Markdown codebase overview | ❌ Not shown in dashboard |
| `zones/{id}/summary.json` | Per-zone detail with metrics | ❌ Not loaded by viewer |
| `zones/{id}/context.md` | Per-zone AI-generated context | ❌ Not loaded by viewer |
| `history/{timestamp}.json` | Zone metric snapshots over time | ❌ No trend visualization |
| `branch-work-*.json` | Completed PRD items per branch | ❌ Not shown in dashboard |

---

## 4. Gap Analysis by Severity

### 4.1 Critical Gaps — Rich Data Completely Invisible

#### GAP-01: Classifications/Archetypes (0% coverage)

**Data available:** 13 fields including archetype definitions with detection signals, per-file classification with confidence scores and evidence chains, distribution summaries by archetype and classification method.

**Current state:** The Files view shows `role` and `category` from inventory.json but completely ignores the richer classifications.json. Users cannot see what archetype a file was assigned, why it was classified that way, or how confident the classification is.

**Impact:** Users miss the semantic layer that explains *what each file does* in the architecture. The archetype catalog (controller, repository, middleware, service, model, etc.) is the bridge between raw file listings and architectural understanding.

**Recommended action:** Add archetype column to Files view; create Archetypes overview panel showing distribution chart and archetype catalog with signal definitions.

#### GAP-02: Call Graph (0% direct coverage)

**Data available:** 17 fields including function definitions with qualified names, caller-to-callee edges with call type classification, hotspot analysis (most-called and most-calling functions), and cycle detection.

**Current state:** Call graph edges are passed to the Zones view for edge weighting but no call graph data is directly visible. Users cannot see which functions are hotspots, what the call chains look like, or whether call cycles exist.

**Impact:** For backend projects especially, the call graph is the primary tool for understanding code complexity and identifying refactoring targets. The `mostCalled[]` and `mostCalling[]` summaries are pre-computed and ready to display.

**Recommended action:** Add call graph metrics to Overview; create hotspot visualization showing most-called/most-calling functions; consider dedicated Call Graph view or integration into Architecture view.

#### GAP-03: Convergence History (0% coverage)

**Data available:** Timestamped JSON snapshots in `.sourcevision/history/` recording zone cohesion, coupling, riskScore, and fileCount at each analysis run.

**Current state:** History files accumulate on disk but are never loaded or displayed. Users have no way to see whether their architectural health is improving or degrading over time.

**Impact:** Without trend visualization, the dashboard provides only point-in-time snapshots. Teams doing incremental refactoring cannot measure progress.

**Recommended action:** Add convergence trend charts showing zone metrics over time; highlight improving/degrading zones.

#### GAP-04: Per-Zone Detail Files (0% coverage)

**Data available:** Per-zone `summary.json` with focused metrics and `context.md` with AI-generated zone-specific analysis.

**Current state:** The Zones view reconstructs zone detail from the top-level zones.json. The dedicated per-zone files are never loaded.

**Impact:** The per-zone context.md files contain richer, zone-scoped AI analysis that could enhance the zone slideout detail panel. Currently this AI-generated content is wasted.

**Recommended action:** Load per-zone context.md into zone detail slideout; display per-zone summary metrics.

### 4.2 Significant Gaps — Data Partially Surfaced

#### GAP-05: Zone Entry Points

**Data available:** `zones[].entryPoints[]` — files identified as the public API surface of each zone.

**Current state:** Entry points are detected and stored but not visually distinguished from other zone files in any view.

**Impact:** Entry points define the contract surface between zones. Highlighting them helps users understand which files are safe to modify (internal) vs. which have downstream consumers (entry points).

**Recommended action:** Visually mark entry point files in Zones view (icon or badge); show entry point count in zone summary cards.

#### GAP-06: Zone Risk Metrics Detail

**Data available:** `riskMetrics.riskLevel` (healthy-to-catastrophic), `failsThreshold`, `riskJustification` (AI-generated explanation).

**Current state:** Risk level is implied by color in some views but the explicit label, threshold failure status, and AI justification are not shown.

**Impact:** Users see red/yellow indicators but don't understand *why* a zone is at risk or what specific threshold it fails.

**Recommended action:** Add risk level badge to zone cards; show riskJustification in zone detail; add threshold indicators.

#### GAP-07: Circular Dependencies Isolation

**Data available:** `summary.circulars[]` with complete cycle paths.

**Current state:** Listed in Overview as text. Not highlighted in the Graph view where they could be visually traced, and not linked to specific zone problems.

**Impact:** Circular dependencies are one of the most actionable findings, but users must mentally map text paths to the graph.

**Recommended action:** Highlight circular dependency edges in Graph view (different color/style); link from Overview circular dep list to Graph view with pre-selected filter.

#### GAP-08: Import Edge Types and Symbols

**Data available:** `edges[].type` (static/dynamic/require/reexport/type) and `edges[].symbols[]`; `external[].symbols[]`.

**Current state:** All import edges rendered identically in Graph view. Symbols never shown anywhere.

**Impact:** The distinction between static vs. dynamic imports, and knowing exactly which symbols cross boundaries, is critical for understanding coupling depth and refactoring safety.

**Recommended action:** Color-code or dash-style edges by import type in Graph view; show symbol list on edge hover/click; display symbols in Architecture external dependency detail.

#### GAP-09: Server Routes to Zone Correlation

**Data available:** `serverRoutes[].file` can be mapped to zones via file membership.

**Current state:** Routes view shows endpoints in isolation. No indication of which architectural zone handles which endpoint.

**Impact:** For backend projects, understanding which zone owns which API surface is fundamental to architecture comprehension.

**Recommended action:** Add zone badge to server route entries; add route count per zone in Zones view.

#### GAP-10: Finding File-Level Traceability

**Data available:** `findings[].scope` references a zone ID; `findings[].related[]` can reference files.

**Current state:** Problems and Suggestions views show findings text and zone scope but cannot drill down to specific files. The `related[]` field is not rendered as navigable links.

**Impact:** Users see "High coupling in zone X" but must manually investigate which files contribute.

**Recommended action:** Render `related[]` as clickable links to Files view; add file list expansion to finding cards.

### 4.3 Minor Gaps — Low-Impact Missing Fields

#### GAP-11: Inventory Timestamps and Distributions

**Fields:** `files[].lastModified`, `summary.byRole`, `summary.byCategory`

**Impact:** Low. Last-modified could enable "recently changed files" sorting. Role/category distributions could be secondary charts in Overview.

#### GAP-12: Component Metadata

**Fields:** `components[].kind`, `components[].line`, `usageEdges[].usageCount`, `routeModules[].exports[]`, `routeModules[].parentLayout`, `summary.mostUsedComponents[]`, `summary.layoutDepth`

**Impact:** Medium for frontend projects, low for backend. Most-used components and layout depth are interesting metrics.

#### GAP-13: Detection Quality and Meta-Evaluation

**Fields:** `zones[].detectionQuality` (genuine/artifact/residual), `metaEvaluationCount`

**Impact:** Low for most users. Could help advanced users understand zone detection reliability.

#### GAP-14: CONTEXT.md and llms.txt

**Files:** AI-generated context documents not shown in dashboard.

**Impact:** Low — these are designed for AI consumption, not human dashboard viewing. Could be useful as a "raw context" tab for power users.

#### GAP-15: Move-File Findings

**Fields:** `findings[].from`, `findings[].to`, `findings[].moveReason`, `findings[].predictedImpact` (only on move-file type findings).

**Impact:** Medium. Move-file recommendations are a distinct finding type with structured fields (source path, destination, reason, predicted impact) that could be rendered as an actionable refactoring checklist rather than plain text.

#### GAP-16: Branch Work Records

**Files:** `.sourcevision/branch-work-*.json` — completed PRD items per branch with change significance and breaking change flags.

**Impact:** Low for SourceVision views specifically. More relevant to Rex/PR workflows.

### 4.4 Proposed New Data Collection — Not Yet Scanned

#### GAP-17: Environment Variables, Config Items, and Global Constants

**Data available:** None — SourceVision does not currently scan for this category of data.

**What should be collected:** A new analysis phase (or extension to an existing phase) that catalogs the project's configuration surface:

| Field | Type | Description |
|-------|------|-------------|
| `entries[].name` | string | Variable/constant name (e.g., `DATABASE_URL`, `MAX_RETRIES`, `API_VERSION`) |
| `entries[].kind` | enum | `env-var` \| `config-item` \| `global-constant` \| `feature-flag` |
| `entries[].valueSource` | enum | `environment` \| `dotenv-file` \| `config-file` \| `hardcoded` \| `cli-arg` \| `computed` |
| `entries[].runtimeAssigned` | boolean | Whether the value is determined at runtime (true) vs. build-time/static (false) |
| `entries[].environmentDependent` | boolean | Whether the value differs across environments (dev/staging/prod) |
| `entries[].definedIn` | string | File path where the variable is defined or first assigned |
| `entries[].definedAtLine` | number | Line number of definition |
| `entries[].referencedBy[]` | array | File paths + line numbers where this variable is read/used |
| `entries[].referenceCount` | number | Total number of call sites across the codebase |
| `entries[].defaultValue` | string \| null | Default/fallback value if detectable (e.g., `process.env.PORT \|\| 3000`) |
| `entries[].required` | boolean \| null | Whether the code enforces presence (throws on missing, marked required in schema) |
| `entries[].type` | string \| null | Inferred type (string, number, boolean, url, path) if detectable |
| `entries[].scope` | enum | `global` \| `module` \| `function` \| `block` — where the constant is accessible |
| `entries[].category` | string \| null | Semantic grouping (e.g., "database", "auth", "api", "logging", "feature-flags") |
| `summary.totalEntries` | number | Total config surface items discovered |
| `summary.byKind` | Record | Distribution by kind |
| `summary.byValueSource` | Record | Distribution by value source |
| `summary.runtimeCount` | number | Entries that are runtime-assigned |
| `summary.environmentDependentCount` | number | Entries that vary by environment |
| `summary.undocumentedEnvVars` | number | Env vars with no default and no .env.example entry |
| `summary.mostReferenced[]` | array | Top entries by reference count — the most load-bearing config values |

**Detection strategy per language:**

| Language | Environment Variables | Config Items | Global Constants |
|----------|---------------------|--------------|------------------|
| TypeScript/JS | `process.env.*`, `import.meta.env.*`, dotenv files | JSON/YAML/TOML config files, config objects | `const` at module scope, `export const`, `Object.freeze()` |
| Go | `os.Getenv()`, `os.LookupEnv()`, env struct tags | Viper/envconfig/config structs | Package-level `const` blocks, `var` at package scope |
| Python | `os.environ[]`, `os.getenv()`, python-dotenv | Settings classes (Django, Pydantic), YAML/TOML config | Module-level UPPER_CASE assignments |
| Rust | `std::env::var()`, dotenv | Config structs (serde), TOML files | `const`, `static`, `lazy_static!` |

**Why this matters:**

- **Configuration drift:** Teams frequently lose track of which env vars are required, which have defaults, and which differ between environments. This is a leading cause of deployment failures.
- **Coupling visibility:** A global constant referenced by 40 files is a hidden coupling hub — changing its value has blast radius comparable to modifying a heavily-imported module, yet it's invisible in the current import graph.
- **Onboarding:** New developers need to understand what to configure before the project runs. An auto-generated config surface catalog eliminates the "ask someone" step.
- **Security audit surface:** Identifying which values come from the environment at runtime helps assess the attack surface of config injection.
- **Refactoring safety:** Knowing all call sites for a config value is essential before changing it. The `referencedBy[]` field provides this traceability.

**Proposed output file:** `config-surface.json` (new Phase 7 or extension to Phase 3 classifications)

**Proposed UI placement:**
- **Dashboard:** Summary metrics — total config entries, runtime vs. static ratio, undocumented env var count
- **Explorer:** Config entries as a filterable panel alongside files, with "referenced by" drill-down
- **Hotspots:** Most-referenced config values as a "config coupling" panel — the constants/env vars with the widest blast radius
- **Architecture:** Zone-scoped config — which zones depend on which environment variables, revealing hidden cross-zone coupling through shared config

**Recommended priority:** **P1** — This is net-new data collection (not just a UI gap), so it requires both analyzer work and UI work. However, the architectural insight it provides (especially for backend projects) justifies prioritizing it alongside the existing P1 items.

---

## 5. Coverage Summary

| Data File | Total Fields | Surfaced | Coverage |
|-----------|-------------|----------|----------|
| inventory.json | 13 | 9 | 69% |
| imports.json | 14 | 8 | 57% |
| classifications.json | 13 | 0 | **0%** |
| zones.json | 24 | 15 | 63% |
| components.json | 22 | 11 | 50% |
| callgraph.json | 17 | 0 | **0%** |
| Supplementary | 10 | 2 | 20% |
| **Total** | **113** | **45** | **40%** |

*Note: "Surfaced" counts fields that are directly visible to users in any view. Fields used only for internal computation (e.g., call graph edges for zone weighting) are not counted as surfaced.*

---

## 6. Current Route Structure Analysis

### 6.1 Current SourceVision Tab Layout

The SourceVision scope has 9 tabs defined in `sourcevision-tabs.ts`:

| Tab | Icon | Min Pass | Feature Gate | Primary Purpose |
|-----|------|----------|--------------|-----------------|
| Overview | ⬣ | 0 | — | Project health snapshot |
| Import Graph | ⬈ | 0 | `sourcevision.callGraph` | Interactive dependency visualization |
| Zones | ⬢ | 0 | — | Architectural zone diagram |
| Files | ☰ | 0 | — | File inventory with filters |
| Routes | ◇ | 0 | — | Client routes + server endpoints |
| Architecture | ◨ | 2 | — | Patterns, hubs, external deps |
| Problems | ⚠ | 3 | — | Anti-patterns and issues |
| Suggestions | ✨ | 4 | — | Improvement recommendations |
| PR Markdown | ✏ | 0 | — | AI-generated PR description |

### 6.2 Structural Issues with Current Layout

**Issue 1: Mixed abstraction levels.** The tab bar mixes raw data browsers (Files, Import Graph) with synthesized insight views (Architecture, Problems, Suggestions). A user browsing files is in "exploration mode"; a user reading suggestions is in "decision mode." These cognitive contexts conflict when placed at the same navigation level.

**Issue 2: Enrichment gating hides high-value content.** Architecture requires pass 2, Problems requires pass 3, Suggestions requires pass 4. For a first-time user running `ndx analyze` with default settings (1 enrichment pass), three of the most valuable views are invisible. The gating makes sense technically (AI content isn't available yet) but creates a cliff experience where the dashboard appears incomplete.

**Issue 3: Overlapping content across tabs.** Architecture, Problems, and Suggestions all source from `findings[]` in zones.json, split by finding type. They share the same underlying dataset but present it in three separate tabs. Similarly, Overview shows zone health metrics that overlap with what Zones shows, and hub file analysis in Architecture overlaps with Import Graph.

**Issue 4: Routes view scope creep.** The Routes tab shows client routes, server endpoints, component definitions, *and* component usage — four distinct datasets collapsed into one view. For backend projects without client routes, the view is confusingly named.

**Issue 5: PR Markdown is a workflow tool, not an analysis view.** It generates content for a specific Git workflow, unlike every other tab which analyzes the codebase. Its presence in the analysis tab bar dilutes the navigation's purpose.

**Issue 6: No home for new data.** Classifications and Call Graph have no obvious tab to live in. Adding them as new tabs would extend the already-long tab bar to 11+ items.

### 6.3 Current Cross-Scope Views

Beyond SourceVision, the full dashboard has 21 ViewIds across 4 scopes:

| Scope | Views | Count |
|-------|-------|-------|
| sourcevision | overview, graph, zones, files, routes, architecture, problems, suggestions, pr-markdown | 9 |
| rex | rex-dashboard, prd, validation, notion-config, integrations | 5 |
| hench | hench-runs, hench-audit, hench-config, hench-templates, hench-optimization | 5 |
| cross-cutting | token-usage, feature-toggles | 2 |

---

## 7. Route Reorganization Recommendations

### 7.1 Guiding Principles

1. **Workflow-oriented grouping:** Organize views by user intent (explore, analyze, act) rather than data source.
2. **Progressive disclosure:** Show the most valuable information first; deeper data available via drill-down, not more tabs.
3. **Adaptive content:** Views should show relevant panels based on project type (frontend/backend/fullstack) rather than being statically scoped.
4. **Fewer tabs, richer views:** Consolidate related data into panels within views rather than spreading thin data across many tabs.

### 7.2 Proposed SourceVision Route Structure

**Replace the current 9 flat tabs with 5 focused views organized by analytical workflow:**

#### View 1: **Dashboard** (replaces Overview)

The entry point. A project health overview that adapts to what data is available.

**Core panels (always shown):**
- Project identity (git info, analysis timestamp, detected languages)
- Health gauges (average cohesion/coupling, circular dependency count)
- Language distribution chart
- Zone count + quick risk summary

**Adaptive panels (shown when data exists):**
- Archetype distribution chart (from classifications.json — GAP-01)
- Call graph complexity metrics: total functions, call density, cycle count (from callgraph.json — GAP-02)
- Server endpoint count + HTTP method distribution (from components.json)
- Convergence trend sparklines (from history/ — GAP-03)

**Rationale:** The current Overview already has this role but misses two entire datasets. Making it adaptive and enriching it with classifications + call graph summaries gives users an immediate sense of project shape.

#### View 2: **Architecture** (merges current Zones + Architecture + Problems + Suggestions)

The analytical core. A unified view for understanding architectural structure and health.

**Primary panel: Zone Topology** (from current Zones view)
- Interactive zone diagram with pan/zoom
- Zone cards showing cohesion, coupling, risk level badge (GAP-06), entry point count (GAP-05)
- Zone slideout with per-zone context.md content (GAP-04)
- Call graph flow overlay: edge weights from function calls, not just imports
- Detection quality indicators on zone cards (GAP-13)

**Secondary panel: Findings** (consolidates Architecture + Problems + Suggestions)
- Unified findings list with type filters (pattern, anti-pattern, suggestion, observation, move-file)
- Severity badges (critical/warning/info)
- File-level traceability via clickable `related[]` links (GAP-10)
- Move-file findings rendered as actionable refactoring cards (GAP-15)
- Scope filtering (global vs. specific zone)

**Tertiary panel: Risk Dashboard**
- Zone risk matrix (cohesion vs. coupling scatter plot)
- Convergence history charts per zone (GAP-03)
- Threshold failure indicators (GAP-06)
- AI risk justifications for at-risk zones

**Rationale:** Architecture, Problems, and Suggestions all derive from the same zone analysis output. Merging them eliminates the enrichment-gate cliff (users see whatever findings exist, gated per-panel rather than per-tab) and creates a single destination for "understand my architecture."

#### View 3: **Explorer** (merges current Files + Import Graph)

The investigation tool. Drill into specific files and their relationships.

**Primary panel: File Browser** (from current Files view)
- Full file inventory with sortable columns
- Added archetype column with confidence badge (GAP-01)
- Entry point indicator badge (GAP-05)
- Zone assignment (existing)
- Last-modified sorting (GAP-11)

**Secondary panel: Dependency Graph** (from current Import Graph)
- Interactive graph visualization
- Edge type differentiation: color/dash by import type (GAP-08)
- Symbol list on edge hover (GAP-08)
- Circular dependency highlighting (GAP-07)
- Call graph overlay toggle: show function-level edges alongside import edges (GAP-02)

**Tertiary panel: File Detail** (new, consolidation)
- Selected file's archetype with evidence chain (GAP-01)
- Imports from/to (existing in Graph)
- Function definitions with call counts (GAP-02)
- Component definitions if applicable
- Zone membership context

**Rationale:** Files and Import Graph serve the same user intent: "I want to understand a specific file or dependency." Combining them with a file selection model that syncs across panels creates a coherent exploration experience.

#### View 4: **Endpoints** (replaces current Routes)

The API surface view. Focused on how the project exposes functionality.

**Primary panel: Server Endpoints** (for backend/fullstack projects)
- Server routes grouped by file or prefix
- HTTP method badges
- Handler function names (GAP-12 for serverRoutes)
- Zone ownership badges per endpoint (GAP-09)
- Database flow tracing (existing backend-frontend work)

**Secondary panel: Client Routes** (for frontend/fullstack projects)
- Route tree with layout hierarchy
- Route convention export badges: loader, action, ErrorBoundary, etc. (GAP-12)
- Layout depth indicator
- Parent layout references

**Tertiary panel: Components** (for frontend/fullstack projects)
- Component definitions with kind badges (GAP-12)
- Most-used components ranking (GAP-12)
- Usage edge count per component (GAP-12)

**Rationale:** Renaming "Routes" to "Endpoints" better describes the view's purpose. Separating server endpoints (primary for backend projects) from client routes (primary for frontend) with adaptive panel ordering makes the view relevant regardless of project type.

#### View 5: **Hotspots** (new view — addresses GAP-02)

The complexity view. Identifies refactoring targets and architectural risk.

**Primary panel: Function Hotspots** (from callgraph.json)
- Most-called functions ranked by caller count
- Most-calling functions ranked by callee count (complexity indicators)
- Call cycle detection with cycle paths
- File → function → caller chain drill-down

**Secondary panel: Hub Files**
- Most-imported files (from imports.json, currently in Architecture)
- Bidirectional coupling detection
- Hub health scoring (red/orange/green by import count)

**Tertiary panel: Archetype Hotspots** (from classifications.json)
- Archetype distribution showing which archetypes dominate
- Unclassified file count (classification coverage)
- Low-confidence classifications flagged for review

**Rationale:** Hotspot analysis is the most actionable output for teams doing refactoring. Currently this data is either invisible (call graph) or scattered (hub files in Architecture, no archetype view at all). A dedicated view creates a "where should I focus?" destination.

### 7.3 PR Markdown Disposition

**Recommendation:** Move PR Markdown out of the SourceVision tab bar. It is a workflow tool, not an analysis view. Two options:

- **Option A:** Float it as a persistent action button in the dashboard header (like a "Generate PR Description" button), accessible from any view.
- **Option B:** Move it to a cross-cutting "Tools" section alongside token-usage and feature-toggles.

### 7.4 Migration Path

The reorganization can be implemented incrementally:

| Phase | Change | Effort | Risk |
|-------|--------|--------|------|
| Phase 1 | Add archetype + call graph data to existing Overview | Low | None — additive |
| Phase 2 | Merge Problems + Suggestions into Architecture tab | Medium | Tab removal — need redirect |
| Phase 3 | Add archetype column to Files view | Low | None — additive |
| Phase 4 | Create Hotspots view with call graph + hub files | Medium | New view |
| Phase 5 | Merge Files + Import Graph into Explorer | High | Major restructure |
| Phase 6 | Rename Routes to Endpoints, add zone correlation | Low | Rename + additive |
| Phase 7 | Extract PR Markdown to header action | Low | Tab removal |

### 7.5 Data Flow After Reorganization

```
inventory.json ──────────────────────→ Dashboard (summary) + Explorer (file browser)
imports.json ────────────────────────→ Dashboard (metrics) + Explorer (graph) + Hotspots (hubs)
classifications.json ────────────────→ Dashboard (distribution) + Explorer (file detail) + Hotspots (archetype)
zones.json ──────────────────────────→ Dashboard (health) + Architecture (topology + findings)
  ├── zones/{id}/context.md ─────────→ Architecture (zone slideout)
  └── history/*.json ────────────────→ Architecture (convergence trends)
components.json ─────────────────────→ Dashboard (metrics) + Endpoints (routes + components)
callgraph.json ──────────────────────→ Dashboard (metrics) + Explorer (overlay) + Hotspots (functions)
config-surface.json ─────────────────→ Dashboard (summary) + Explorer (config panel) + Hotspots (config coupling) + Architecture (zone config deps)
manifest.json ───────────────────────→ Dashboard (project identity)
```

---

## 8. Prioritized Implementation Recommendations

Combining gap closure with route reorganization:

| Priority | Action | Gaps Addressed | Effort |
|----------|--------|----------------|--------|
| **P0** | Add classifications data to Overview + Files view | GAP-01 | Medium |
| **P0** | Add call graph metrics to Overview + new Hotspots panel | GAP-02 | Medium |
| **P1** | Merge findings views (Architecture + Problems + Suggestions) | Structural | Medium |
| **P1** | Add zone entry point badges | GAP-05 | Low |
| **P1** | Add zone risk level labels + justification | GAP-06 | Low |
| **P1** | Add zone badges to server routes | GAP-09 | Low |
| **P2** | Add convergence history trend charts | GAP-03 | Medium |
| **P2** | Highlight circular deps in graph view | GAP-07 | Low |
| **P2** | Differentiate import edge types visually | GAP-08 | Medium |
| **P2** | Make finding `related[]` clickable | GAP-10 | Low |
| **P2** | Load per-zone context.md in slideout | GAP-04 | Low |
| **P3** | Merge Files + Graph into Explorer view | Structural | High |
| **P3** | Rename Routes to Endpoints | Structural | Low |
| **P3** | Relocate PR Markdown to header action | Structural | Low |
| **P3** | Add move-file finding cards | GAP-15 | Low |
| **P3** | Add minor inventory/component fields | GAP-11, GAP-12 | Low |
| **P1** | New analyzer: environment variables, config items, global constants | GAP-17 | High |

---

## 9. Appendix A: Complete View-to-Data Mapping

### Current state: which views consume which data files

| View | inventory | imports | classifications | zones | components | callgraph | manifest | API |
|------|-----------|---------|-----------------|-------|------------|-----------|----------|-----|
| Overview | summary | summary | — | summary | summary | — | metadata | — |
| Import Graph | file metadata | edges | — | file-zone map | — | — | — | — |
| Zones | — | — | — | zones, crossings, subZones | — | edge weighting | — | — |
| Files | files array | incoming count | — | file-zone map | — | — | — | — |
| Routes | — | — | — | — | routes, components, usage | — | — | — |
| Architecture | — | external, hubs | — | findings (pattern, relationship) | serverRoutes | — | — | /api/sv/db-packages |
| Problems | — | — | — | findings (anti-pattern) | — | — | — | — |
| Suggestions | — | — | — | findings (suggestion) | — | — | — | — |
| PR Markdown | — | — | — | — | — | — | — | /api/sv/pr-markdown |

### Proposed state: which reorganized views would consume which data files

| View | inventory | imports | classifications | zones | components | callgraph | config-surface | manifest | supplementary |
|------|-----------|---------|-----------------|-------|------------|-----------|----------------|----------|---------------|
| Dashboard | summary | summary | summary | summary | summary | summary | summary | metadata | — |
| Architecture | — | — | — | zones, crossings, findings, risk | — | edge weighting | zone config deps | — | zones/*/context.md, history/*.json |
| Explorer | files array | edges, external | files array | file-zone map | — | overlay edges | entries, referencedBy | — | — |
| Endpoints | — | — | — | file-zone map | routes, components, usage, server | — | — | — | — |
| Hotspots | — | mostImported, hubs | summary, byArchetype | — | — | summary, mostCalled, mostCalling | mostReferenced | — | — |

---

## 10. Appendix B: Real-World Data Sample

Analysis output from `go-backend-clean-architecture` project:

- **79 files** across Go (50), Markdown (10), JSON (5), Other (12), Dockerfile (1)
- **4,298 lines** of code
- **7 zones** detected: api-controllers, app-entrypoint, application-startup, data-repository, jwt-auth-middleware, mongo-client-infra, project-configuration
- **79 import edges** with 25 external packages (including Go stdlib and third-party)
- **6 server routes** across 5 handler files (chi framework)
- **25 external packages** including `go.mongodb.org/mongo-driver`, `github.com/go-chi/chi`, `golang.org/x/crypto`
- **4 convergence history snapshots** (from repeated analysis runs)
- **2 LLM API calls** (Sonnet 4.6) for zone enrichment only

This project demonstrates the backend-heavy profile where call graph, classifications, and route-to-zone correlation gaps are most impactful.

---

## 11. Appendix C: MCP Tool Coverage

SourceVision exposes 10 MCP tools. Coverage comparison with dashboard:

| MCP Tool | Data Returned | Dashboard Equivalent | Gap |
|----------|--------------|---------------------|-----|
| `get_overview` | Project summary, counts, languages | Overview view | Aligned |
| `get_next_steps` | Prioritized improvement list | No equivalent | ❌ Dashboard has no "next steps" view |
| `get_zone` | Zone detail + scoped findings + crossings | Zones slideout | Partial — zone slideout doesn't show crossings list |
| `get_findings` | Filtered findings by type/severity | Architecture + Problems + Suggestions | Aligned (split across views) |
| `get_file_info` | File metadata + archetype + zone + imports | Files view | ❌ Archetype not shown |
| `search_files` | File search by path/role/language | Files view filters | Aligned |
| `get_imports` | Import edges + circulars for a file | Graph view | Partial — no per-file focus mode |
| `get_classifications` | Archetype assignments + evidence | No equivalent | ❌ Entire dataset missing |
| `set_file_archetype` | Override archetype | No equivalent | ❌ No edit UI |
| `get_route_tree` | Route structure + conventions | Routes view | Aligned |

Notable: `get_next_steps` and `get_classifications` have no dashboard equivalent at all.
