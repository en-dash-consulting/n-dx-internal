# Go Language Integration — Implementation Plan

> **Status:** Proposed
> **Date:** 2026-03-25
> **Prerequisite:** [go-integration-discovery.md](./go-integration-discovery.md)

---

## Design Principles

1. **Additive, not invasive** — Go support extends existing analyzers; it doesn't fork them. JS/TS behavior is the default path and must not regress.
2. **Language registry as backbone** — A central language configuration drives all downstream decisions (extensions, skip dirs, test patterns, archetypes, import parsing).
3. **Auto-detect with override** — Detect project language from markers (`go.mod`, `package.json`). Allow explicit override in `.n-dx.json`.
4. **Ship incrementally** — Three phases, each independently shippable and testable.

---

## Phase 1: Foundation — Language Registry & Inventory (Effort: ~1 week)

**Goal:** SourceVision can inventory a Go project, classify files correctly, and produce accurate `inventory.json` and `llms.txt` output.

### 1.1 Create Language Registry

**New file:** `packages/sourcevision/src/language/registry.ts`

```typescript
export interface LanguageConfig {
  id: string;                          // "go", "typescript", "javascript"
  displayName: string;                 // "Go", "TypeScript"
  extensions: Set<string>;             // [".go"]
  parseableExtensions: Set<string>;    // Extensions the import parser can handle
  testFilePatterns: RegExp[];          // [/_test\.go$/]
  configFilenames: Set<string>;        // ["go.mod", "go.sum", ".golangci.yml"]
  skipDirectories: Set<string>;        // ["vendor"]
  generatedFilePatterns: RegExp[];     // [/_gen\.go$/, /\.pb\.go$/, /wire_gen\.go$/]
  entryPointPatterns: RegExp[];        // [/^main\.go$/]
  moduleFile?: string;                 // "go.mod" — the package manifest
}
```

**New file:** `packages/sourcevision/src/language/go.ts`
**New file:** `packages/sourcevision/src/language/typescript.ts`
**New file:** `packages/sourcevision/src/language/detect.ts`

Detection logic:
1. Check `.n-dx.json` for explicit `language` field
2. Check for `go.mod` → Go
3. Check for `package.json` → JS/TS
4. Check for both → mixed (default to primary based on file count)
5. Fallback → JS/TS (current behavior, backward compatible)

### 1.2 Update Inventory Analyzer

**File:** `packages/sourcevision/src/analyzers/inventory.ts`

Changes:
- Import language registry
- Replace hardcoded `SKIP_DIRS` with `baseSkipDirs + languageConfig.skipDirectories`
- Replace hardcoded `CONFIG_FILENAMES` with `baseConfigFiles + languageConfig.configFilenames`
- Add Go-specific role classification:
  - `_test.go` → role `"test"`
  - `_gen.go`, `.pb.go`, `wire_gen.go`, `mock_*.go` → role `"generated"`
  - `testdata/` contents → role `"asset"`
  - `cmd/*/main.go` → role `"source"` (entrypoint archetype applied later)

### 1.3 Update .n-dx.json Schema

**File:** `config.js` (and related schema files)

Add optional `language` field:
```json
{
  "language": "go",
  ...
}
```

Valid values: `"typescript"`, `"javascript"`, `"go"`, `"auto"` (default).

### 1.4 Tests

| Test | Type | Validates |
|------|------|-----------|
| `language-registry.test.ts` | Unit | Registry returns correct config for each language |
| `language-detect.test.ts` | Unit | Auto-detection from project markers |
| `inventory-go.test.ts` | Integration | Go project inventory (fixture with go.mod, _test.go, cmd/, internal/) |

### 1.5 Deliverables

- Go projects produce correct `inventory.json` with proper language, role, and category classification
- `llms.txt` and `CONTEXT.md` reflect Go file structure
- `.sourcevision/manifest.json` records detected language
- JS/TS behavior unchanged (all existing tests pass)

---

## Phase 2: Import Graph & Zones (Effort: ~1–2 weeks)

**Goal:** SourceVision builds an accurate import graph for Go projects, enabling zone detection (Louvain community detection) to work correctly.

### 2.1 Go Import Parser

**New file:** `packages/sourcevision/src/analyzers/go-imports.ts`

Strategy: **Regex-based parsing** for v1 (no external tool dependency).

```typescript
export function extractGoImports(sourceText: string, filePath: string): RawImport[];
```

Parsing approach:
1. Find `import "pkg"` single imports
2. Find `import ( ... )` grouped imports
3. Handle aliases: `alias "pkg"`, `_ "pkg"`, `. "pkg"`
4. Classify each import:
   - Standard library (no domain prefix): `"fmt"`, `"net/http"` → external with `package: "stdlib:<pkg>"`
   - Third-party (has domain): `"github.com/..."` → external
   - Internal (starts with module path from `go.mod`): `"mymodule/internal/handler"` → internal edge

**Module path resolution:**
1. Read `go.mod` once at analysis start to get module path
2. For each import starting with module path, resolve to relative file path
3. Map `"mymodule/internal/handler"` → `internal/handler/*.go` (all `.go` files in package dir)

**Edge mapping difference from JS/TS:**
- JS/TS: file-to-file edges (`src/a.ts` → `src/b.ts`)
- Go: file-to-package edges (`cmd/api/main.go` → `internal/handler/` directory)
- For zone detection, package-level granularity is actually better in Go

### 2.2 Update Import Analyzer Router

**File:** `packages/sourcevision/src/analyzers/imports.ts`

Add dispatch logic:
```typescript
// At the top of the analyze function:
const lang = detectLanguage(filePath);
if (lang === "Go") {
  return extractGoImports(sourceText, filePath);
}
// ... existing JS/TS parsing
```

Or, cleaner: create an `extractImportsForLanguage()` router function that delegates to the correct parser.

### 2.3 Update Extension Gates

Files that filter on `JS_TS_EXTENSIONS`:
- `imports.ts` — add `.go` or use language registry
- `callgraph.ts` — add `.go` (Phase 3)
- `server-route-detection.ts` — add `.go` (Phase 3)
- `components.ts` — skip `.go` files (Go has no components)

### 2.4 Zone Detection

The Louvain community detection algorithm operates on the import graph edges. It is completely language-agnostic — it just needs nodes (files) and edges (imports). Once the Go import parser produces edges, zone detection works automatically.

**Go-specific zone naming hints:**
- `cmd/api/` → `cmd-api` zone
- `internal/handler/` → `internal-handler` zone
- `internal/service/` → `internal-service` zone
- `pkg/auth/` → `pkg-auth` zone

These follow Go's directory-as-package convention naturally.

### 2.5 Tests

| Test | Type | Validates |
|------|------|-----------|
| `go-imports.test.ts` | Unit | All import syntax variants parsed correctly |
| `go-imports-resolution.test.ts` | Unit | Module path → file path resolution |
| `go-imports-integration.test.ts` | Integration | Full import graph from Go fixture project |
| `go-zones.test.ts` | Integration | Zone detection produces sensible zones from Go import graph |

### 2.6 Deliverables

- `imports.json` contains accurate edges for Go projects
- Zone detection works on Go import graphs
- `zones.json` reflects Go package structure
- External dependency tracking (third-party Go modules)
- Circular import detection (rare in Go but possible)

---

## Phase 3: Archetypes, Routes & Hench (Effort: ~1–2 weeks)

**Goal:** Full end-to-end workflow: SourceVision produces rich analysis, Rex can scan and propose PRD items, Hench can execute tasks in Go projects.

### 3.1 Go Archetypes

**File:** `packages/sourcevision/src/analyzers/archetypes.ts`

**Strategy:** Add Go-aware signals to existing archetypes and add new Go-specific archetypes.

Modifications to existing archetypes:
```typescript
// entrypoint — add Go signals
{ kind: "filename", pattern: "^main\\.go$", weight: 0.9 },
{ kind: "directory", pattern: "/cmd/", weight: 0.7 },

// utility — add Go signals
{ kind: "filename", pattern: "\\.go$", weight: 0.1 }, // low weight, combines with directory
// (directory signals /core/, /utils/, /helpers/, /lib/ already work for Go)

// types — add Go signals
{ kind: "filename", pattern: "^types\\.go$", weight: 0.9 },
{ kind: "filename", pattern: "^models\\.go$", weight: 0.8 },
{ kind: "filename", pattern: "^entities\\.go$", weight: 0.8 },

// route-handler — add Go signals
{ kind: "filename", pattern: "^handler\\.go$", weight: 0.8 },
{ kind: "filename", pattern: "^handlers\\.go$", weight: 0.8 },
{ kind: "directory", pattern: "/handler/", weight: 0.8 },
{ kind: "directory", pattern: "/handlers/", weight: 0.8 },

// middleware — existing /middleware/ signal already works for Go

// model — existing /models/ signal already works for Go

// service — existing /services/ signal already works for Go

// config — add Go signal
{ kind: "filename", pattern: "^config\\.go$", weight: 0.7 },

// cli-command — existing /cmd/ signal already works for Go

// test-helper — add Go signals
{ kind: "directory", pattern: "/testdata/", weight: 0.9 },
{ kind: "directory", pattern: "/testutil/", weight: 0.8 },
{ kind: "filename", pattern: "^helpers_test\\.go$", weight: 0.7 },
```

Remove React-specific archetypes from Go context:
- `route-module` — skip for Go (no file-based routing)
- `component` — skip for Go (no UI components)
- `hook` — skip for Go (no React hooks)
- `page` — skip for Go (no page components)

**Implementation:** Add a `languages?: string[]` field to each signal. If present, the signal only fires when the project language matches. If absent, fires for all languages (backward compatible).

### 3.2 Go Server Route Detection

**New file:** `packages/sourcevision/src/analyzers/go-route-detection.ts`

Detect route registrations in Go HTTP frameworks:

```typescript
export function detectGoRoutes(sourceText: string, filePath: string): RouteEntry[];
```

Pattern matching for:
- `http.HandleFunc("/path", handler)` — stdlib
- `r.Get("/path", handler)` — chi
- `r.GET("/path", handler)` — gin
- `e.GET("/path", handler)` — echo
- `app.Get("/path", handler)` — fiber
- `r.HandleFunc("/path", handler).Methods("GET")` — gorilla/mux

Output uses the existing `RouteEntry` type — the schema is already language-agnostic.

### 3.3 Rex Scanner Updates

**File:** `packages/rex/src/analyze/scanners.ts`

Add Go-aware scanning:
- `scanGoMod()` — parse `go.mod` for module info, Go version, dependencies
- `scanMakefile()` — extract Make targets as potential tasks
- Update test file detection to include `_test.go`
- Update skip directories to include `vendor/`

### 3.4 Hench Configuration for Go

**File:** `packages/hench/src/schema/templates.ts` (or equivalent defaults)

Add Go project template:
```json
{
  "guard": {
    "allowedCommands": ["go", "make", "git", "golangci-lint", "mockgen", "wire", "buf"],
    "blockedPaths": [".hench/**", ".rex/**", ".git/**", "vendor/**"]
  }
}
```

**File:** `packages/hench/src/tools/test-runner.ts`

Add Go test runner:
```typescript
// Go test discovery
const GO_TEST_PATTERN = /_test\.go$/;

// Go test execution
// go test ./internal/handler/... — run tests in specific package
// go test ./... — run all tests
// go test -run TestName ./pkg/... — run specific test
```

### 3.5 Hench Agent Prompts

**File:** `packages/hench/src/agent/planning/prompt.ts`

The agent brief/prompt should be language-aware:
- For Go: reference `go test`, `go build`, `go vet`, `golangci-lint run`
- For Go: reference Go conventions (exported = PascalCase, unexported = camelCase)
- For Go: reference Go project structure (`cmd/`, `internal/`, `pkg/`)

### 3.6 Tests

| Test | Type | Validates |
|------|------|-----------|
| `go-archetypes.test.ts` | Unit | Go files match correct archetypes |
| `go-route-detection.test.ts` | Unit | Chi, gin, echo, fiber, stdlib route patterns |
| `go-mod-scanner.test.ts` | Unit | go.mod parsing |
| `hench-go-config.test.ts` | Unit | Go guard defaults |
| `hench-go-test-runner.test.ts` | Unit | Go test discovery and execution |
| `go-e2e.test.ts` | E2E | Full ndx init → analyze → plan on a Go fixture project |

### 3.7 Deliverables

- Archetypes classify Go files accurately
- Server routes detected in Go HTTP frameworks
- Rex produces meaningful PRD proposals for Go projects
- Hench can execute tasks in Go projects (run tests, build, lint)
- End-to-end workflow works: `ndx init` → `ndx analyze` → `ndx plan` → `ndx work`

---

## Phase 4 (Future): Advanced Go Analysis

Not in scope for initial integration, but documented for planning:

1. **Go call graph** — function-level call graph using `go/ast` or `guru`
2. **Interface catalog** — catalog all interfaces and their implementations
3. **Package cycle detection** — detect import cycles (Go compiler already prevents this, but SourceVision can flag near-cycles and coupling)
4. **Go-specific findings** — large interfaces (>5 methods), empty interfaces (`interface{}`), package naming violations, stuttering (`http.HTTPClient`)
5. **Mixed-language support** — projects with both Go backend and JS frontend (run both analyzer sets, merge zone graphs)
6. **Go workspace support** — `go.work` multi-module workspaces (similar to pnpm workspaces)

---

## Test Fixture: Go Reference Project

Create a minimal Go project fixture for testing:

```
tests/fixtures/go-project/
  go.mod
  go.sum
  Makefile
  .golangci.yml
  cmd/
    api/
      main.go           # entry point
  internal/
    handler/
      user.go           # HTTP handlers
      user_test.go      # handler tests
    service/
      user.go           # business logic
      user_test.go
    repository/
      user.go           # data access
      user_test.go
    middleware/
      auth.go           # auth middleware
      logging.go        # logging middleware
    config/
      config.go         # configuration loading
  pkg/
    response/
      json.go           # shared response utilities
  api/
    openapi.yaml        # API specification
  migrations/
    001_create_users.sql
  testdata/
    users.json          # test fixtures
```

This fixture exercises:
- Entry point detection (`cmd/api/main.go`)
- Standard Go layout (`internal/`, `pkg/`, `cmd/`)
- All archetype categories (handler, service, repository, middleware, config)
- Test file detection (`_test.go`)
- Config file detection (`go.mod`, `.golangci.yml`, `Makefile`)
- Import graph (internal cross-package imports)
- Route detection (HTTP handlers)

---

## Migration Path

### For Existing JS/TS Projects

Zero impact. The language registry defaults to JS/TS behavior. All existing tests continue to pass. No config changes required.

### For New Go Projects

```sh
ndx init .          # detects go.mod, sets language: "go"
ndx analyze .       # runs Go-aware analyzers
ndx plan .          # proposes Go-relevant PRD items
ndx work .          # executes with Go toolchain (go test, go build)
```

### For Mixed Projects

```json
// .n-dx.json
{
  "language": "auto",  // or explicitly: ["go", "typescript"]
  ...
}
```

Mixed-language support is deferred to Phase 4. For v1, the primary language is used for all analysis.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Go import regex misses edge cases | Medium | Low | Comprehensive test fixtures; fallback to `go list` if available |
| Zone detection produces poor results for Go | Low | Medium | Go's package structure maps naturally to zones; test with real Go projects |
| Archetype language filtering adds complexity | Low | Low | Simple `languages` field with backward-compatible default |
| Hench agent struggles with Go idioms | Medium | Medium | Language-aware prompt templates; test with real Go tasks |
| Breaking existing JS/TS behavior | Low | High | All changes additive; run full existing test suite in CI |
