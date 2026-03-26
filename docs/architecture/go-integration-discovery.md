# Go Language Integration — Discovery Document

> **Status:** Discovery
> **Date:** 2026-03-25
> **Scope:** Inventory of all JS/TS-specific assumptions across n-dx packages that must be abstracted or extended to support Go codebases.

---

## Executive Summary

n-dx was built with a focus on frontend TypeScript/JavaScript projects and has only been tested in that ecosystem. Extending support to Go is the first step toward multi-language capability. This document catalogs every JS/TS assumption across all three core packages (SourceVision, Rex, Hench) and the foundation layer (llm-client), organized by subsystem and severity.

**Key finding:** The core architectural analysis pipeline (zone detection via Louvain community detection, enrichment, findings, PRD management, agent loop) is fundamentally language-agnostic. The JS/TS specificity is concentrated in two areas:

1. **SourceVision analyzers** — file parsing, import extraction, component detection, route detection
2. **Hench guard/tool configuration** — allowed commands, test runner patterns

This means Go support can be achieved primarily through **extending existing analyzers** and **adding language-aware configuration**, rather than a fundamental redesign.

---

## 1. SourceVision — Inventory Analyzer

**File:** `packages/sourcevision/src/analyzers/inventory.ts`

### 1.1 Skip Directories (lines 17–32)

```typescript
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", ".nuxt", ".svelte-kit",
  ".turbo", ".cache", "coverage", ".output", "dist", "build", "__pycache__",
  ".react-router",
]);
```

**Impact:** Low — most are already irrelevant for Go projects. However, Go-specific directories should be added.

**Go equivalents to skip:**
- `vendor/` — Go vendor directory (equivalent to `node_modules/`)

**Go equivalents that are NOT skipped but may appear:**
- `internal/` — Go convention for package-private code (should NOT be skipped — it's source code)
- `cmd/` — Go convention for CLI entry points (should NOT be skipped)
- `pkg/` — Go convention for exported library packages (should NOT be skipped)

### 1.2 Language Detection (lines 36–108)

```typescript
".go": "Go",  // Already present!
```

**Impact:** None — `.go` is already mapped. No change needed.

### 1.3 Config File Detection (lines ~130–225)

The `CONFIG_FILENAMES` set contains 60+ JS/TS/Node config files. These are used to classify files with role `"config"`.

**Go config files to add:**
- `go.mod` — module declaration and dependencies (equivalent to `package.json`)
- `go.sum` — dependency checksums (equivalent to `pnpm-lock.yaml`)
- `Makefile` — common in Go projects for build/test/lint targets
- `.golangci.yml` / `.golangci.yaml` — golangci-lint configuration
- `.goreleaser.yml` / `.goreleaser.yaml` — release automation
- `air.toml` / `.air.toml` — live reload config (equivalent to nodemon)
- `buf.yaml` / `buf.gen.yaml` — protobuf generation config
- `.goose.yml` — database migration config
- `sqlc.yaml` — SQL code generation config

### 1.4 Role Classification

The `classifyRole()` function uses extension and path heuristics:

```typescript
// Test detection: .test.ts, .spec.ts, __tests__/
```

**Go test convention:**
- Files ending in `_test.go` are test files (Go enforced, not convention)
- No `__tests__/` directory convention
- `testdata/` directories contain test fixtures (should be role `"asset"` or `"test"`)

---

## 2. SourceVision — Import Analyzer

**File:** `packages/sourcevision/src/analyzers/imports.ts`

### 2.1 Parseable Extensions (lines 23–24)

```typescript
const JS_TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const PROBE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
```

**Impact:** Critical — `.go` files are completely excluded from import graph analysis. No import edges are built for Go files.

### 2.2 AST Parsing (line 43)

Uses `ts.createSourceFile()` from the TypeScript compiler API. This is fundamentally JS/TS-specific and cannot parse Go.

**Go import parsing approach:**
- Go imports are syntactically simple: `import "fmt"` or `import ( "fmt"; "net/http" )`
- A regex-based parser would cover 95%+ of cases
- For full accuracy: shell out to `go list -json ./...` which outputs structured import data
- Or: use a simple Go AST parser (the `import` block is always at the top of the file)

### 2.3 Module Resolution (lines 260–285)

JS/TS module resolution is complex: strip `.js`, probe `.ts`/`.tsx`/`.jsx`, resolve `index.ts`, etc.

**Go module resolution is simpler:**
- Import paths are always fully qualified: `"github.com/user/repo/pkg/handler"`
- No extension stripping or probing
- Local imports use the module path from `go.mod` as prefix
- Standard library imports have no domain prefix: `"fmt"`, `"net/http"`
- `internal/` packages are importable only within the parent module

### 2.4 ImportType Enum

```typescript
export type ImportType = "static" | "dynamic" | "require" | "reexport" | "type";
```

**Go equivalents:**
- `"static"` — all Go imports are static (resolved at compile time)
- `"dynamic"` — not applicable (Go has no dynamic imports)
- `"require"` — not applicable
- `"reexport"` — not directly applicable (Go doesn't re-export; packages are the unit)
- `"type"` — not applicable (Go doesn't separate type imports)

**Recommendation:** The `"static"` type covers all Go imports. No schema change needed, but `"require"`, `"dynamic"`, `"reexport"`, and `"type"` will never appear for Go files.

---

## 3. SourceVision — Component Analyzer

**File:** `packages/sourcevision/src/analyzers/components.ts`

### 3.1 JSX Extensions (lines 35–36)

```typescript
const JSX_EXTENSIONS = new Set([".tsx", ".jsx"]);
const ALL_PARSEABLE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
```

**Impact:** Critical — the entire component analyzer is React/Preact-specific.

### 3.2 Component Detection Logic

The analyzer detects:
- Functions returning JSX (`returnsJsx()`)
- `React.Component` / `PureComponent` class inheritance
- `forwardRef()` wrapping
- Hook naming convention (`use*`)
- Remix route convention exports (`loader`, `action`, `meta`, etc.)

**Go has no equivalent concept.** Go doesn't have a UI component model. However, the component analyzer's output format (`ComponentDefinition`) could be repurposed for Go to catalog:

- **Interface definitions** — Go interfaces are the primary abstraction boundary
- **Struct definitions** — data types that form the core domain model
- **Handler functions** — HTTP handler signatures (`func(w http.ResponseWriter, r *http.Request)`)

**Recommendation:** For v1 Go support, skip the component analyzer entirely. Go projects don't need component catalogs. The zone and import analysis provides sufficient architectural insight. If interface/struct cataloging is desired later, it should be a separate Go-specific analyzer.

---

## 4. SourceVision — Route Detection

**File:** `packages/sourcevision/src/analyzers/route-detection.ts`

### 4.1 File-Based Routing (Remix/React Router)

Detects:
- `app/routes.ts` config files
- `route()`, `index()`, `layout()`, `prefix()` calls
- Dot-notation file-based routes (`users.$id.tsx`)

**Go has no file-based routing convention.** Routes are declared programmatically.

### 4.2 Server Route Detection

**File:** `packages/sourcevision/src/analyzers/server-route-detection.ts`

Detects Express/Hono/Koa patterns: `.get("/path", handler)`, `.post(...)`, etc.

**Go HTTP framework patterns to detect:**

| Framework | Pattern | Example |
|-----------|---------|---------|
| net/http | `http.HandleFunc("/path", handler)` | `http.HandleFunc("/users", getUsers)` |
| net/http | `mux.Handle("/path", handler)` | `mux.Handle("/api/", apiHandler)` |
| chi | `r.Get("/path", handler)` | `r.Get("/users/{id}", getUser)` |
| chi | `r.Route("/path", func(r chi.Router) {...})` | Nested route groups |
| gin | `r.GET("/path", handler)` | `r.GET("/users/:id", getUser)` |
| echo | `e.GET("/path", handler)` | `e.GET("/users/:id", getUser)` |
| fiber | `app.Get("/path", handler)` | `app.Get("/users/:id", getUser)` |
| gorilla/mux | `r.HandleFunc("/path", handler).Methods("GET")` | Method chaining |

**Recommendation:** Implement Go server route detection as a separate analyzer that uses regex or simple AST patterns on `.go` files. The output format (`RouteEntry`) is already language-agnostic.

---

## 5. SourceVision — Call Graph Analyzer

**File:** `packages/sourcevision/src/analyzers/callgraph.ts`

### 5.1 Extension Filter (line 28)

```typescript
const JS_TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
```

### 5.2 AST Parsing

Uses TypeScript compiler API for:
- Function/method definition extraction
- Call site detection
- Class method qualification

**Go call graph extraction approaches:**

1. **Regex-based (fastest, least accurate):** Match `func FunctionName(` and `FunctionName(` call sites
2. **`go list -json`:** Provides package-level dependency information but not function-level
3. **`guru` / `gopls`:** Go language server can provide call hierarchy
4. **Custom Go tool:** Write a small Go program using `go/parser` and `go/ast` that outputs JSON — this could be bundled as a binary or invoked via `go run`

**Recommendation:** For v1, use regex-based extraction. It handles the common cases:
- `func Name(params) returnType {` — function definitions
- `func (r *Receiver) Name(params) returnType {` — method definitions
- `pkg.Name(args)` — qualified calls

---

## 6. SourceVision — Archetype Definitions

**File:** `packages/sourcevision/src/analyzers/archetypes.ts`

### 6.1 JS/TS-Specific File Patterns

Every archetype uses `[tj]sx?` extension patterns:

```typescript
{ kind: "filename", pattern: "^index\\.[tj]sx?$", weight: 0.8 }
{ kind: "filename", pattern: "^types\\.[tj]sx?$", weight: 0.9 }
{ kind: "filename", pattern: "^use[A-Z].*\\.[tj]sx?$", weight: 0.9 }
```

**Go equivalents:**

| JS/TS Archetype | Go Equivalent | Go Signals |
|----------------|---------------|------------|
| `entrypoint` | `entrypoint` | `main.go` in `cmd/*/` directories, `package main` declaration |
| `utility` | `utility` | `/pkg/`, `/internal/`, `/lib/` directories |
| `types` | `types` | Files named `types.go`, `models.go`, `entities.go` |
| `route-handler` | `handler` | `/handlers/`, `/handler/`, `_handler.go` suffix |
| `route-module` | N/A | No equivalent in Go |
| `component` | N/A | No equivalent in Go |
| `hook` | N/A | No equivalent in Go |
| `store` | `repository` | `/repository/`, `/repo/`, `_repo.go`, `_repository.go` |
| `middleware` | `middleware` | `/middleware/`, `_middleware.go` |
| `model` | `model` | `/models/`, `_model.go` |
| `gateway` | `gateway` | Same pattern works |
| `config` | `config` | `config.go`, `/config/` |
| `service` | `service` | `/service/`, `/services/`, `_service.go` |
| `schema` | `schema` | Same pattern works |
| `cli-command` | `cli-command` | `/cmd/`, `/commands/` |
| `page` | N/A | No equivalent in Go |
| `test-helper` | `test-helper` | `/testdata/`, `_test.go` helper files, `/testutil/` |

**New Go-specific archetypes:**

| ID | Name | Signals |
|----|------|---------|
| `interface` | Interface Contract | Files with heavy `type X interface {` declarations |
| `wire` | Dependency Injection | Wire/DI configuration (`wire.go`, `wire_gen.go`, `/di/`) |
| `migration` | Database Migration | `/migrations/`, `*.sql` in migration dirs |
| `proto` | Protocol Buffer | `*.proto` files and generated `*.pb.go` |

### 6.2 Pattern Extension Strategy

The current archetype system supports `filename`, `directory`, and `export` signal kinds. For Go, `filename` and `directory` are sufficient. The `export` kind (which checks for named exports like `loader`, `action`) is React-specific and not needed for Go.

**Recommendation:** Make archetype definitions language-aware by either:
1. Adding a `languages` field to each signal (whitelist approach), or
2. Creating language-specific archetype overlays that extend the base set

---

## 7. SourceVision — Schema Types

**File:** `packages/sourcevision/src/schema/v1.ts`

### 7.1 ImportType (line 108)

```typescript
export type ImportType = "static" | "dynamic" | "require" | "reexport" | "type";
```

For Go, only `"static"` is used. No schema change needed — the other types simply won't appear.

### 7.2 FileRole (lines 70–78)

```typescript
export type FileRole = "source" | "test" | "config" | "docs" | "generated" | "asset" | "build" | "other";
```

Language-agnostic. Works for Go as-is. The `"generated"` role maps well to `wire_gen.go`, `*.pb.go`, `*_gen.go`, `mock_*.go`, etc.

### 7.3 Zone/Finding/Manifest Types

All language-agnostic. No changes needed.

---

## 8. Rex — Scanners

**File:** `packages/rex/src/analyze/scanners.ts`

### 8.1 Skip Directories (lines 27–36)

```typescript
const SKIP_DIRS = ["node_modules", ".next", ".turbo", ".react-router", ...];
```

**Go additions:** `vendor/`

### 8.2 Skip Config Files (lines 53–69)

Contains `package.json`, `tsconfig.json`, `jest.config.*`, `vite.config.*`, etc.

**Go additions:** `go.mod`, `go.sum`

### 8.3 Test File Detection (lines 102–106)

```typescript
/\.test\.(ts|tsx|js|jsx)$/
/\.spec\.(ts|tsx|js|jsx)$/
/__tests__\//
```

**Go pattern:** `/_test\.go$/` — single pattern covers all Go tests.

### 8.4 Package Scanner (lines 848–955)

Parses `package.json` for scripts, dependencies, devDependencies.

**Go equivalent:** Parse `go.mod` for:
- Module name
- Go version requirement
- Dependencies (`require` block)
- Replace directives (local development overrides)

**Go build/task equivalents:**
- `Makefile` targets → equivalent to `package.json` scripts
- Common targets: `build`, `test`, `lint`, `run`, `generate`, `migrate`

---

## 9. Hench — Guard Configuration

**File:** `packages/hench/src/guard/commands.ts`

### 9.1 Default Allowed Commands

```json
{
  "allowedCommands": ["npm", "npx", "node", "git", "tsc", "vitest"]
}
```

**Go equivalents:**
- `go` — build, test, run, generate, vet, mod tidy
- `make` — Makefile targets
- `golangci-lint` — linting
- `mockgen` — mock generation
- `wire` — dependency injection code generation
- `sqlc` — SQL code generation
- `buf` — protobuf generation
- `git` — already allowed

### 9.2 Shell Guard (commands.ts)

The `validateCommand()` function is language-agnostic — it checks for shell metacharacters and dangerous patterns. No changes needed.

### 9.3 Path Guard

The `blockedPaths` config blocks `.hench/`, `.rex/`, `.git/`, `node_modules/`.

**Go addition:** Consider adding `vendor/` to blocked paths (shouldn't be modified by agents).

---

## 10. Hench — Test Runner

**File:** `packages/hench/src/tools/test-runner.ts`

### 10.1 Test File Patterns (lines 53–58)

```typescript
const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/,
  /_test\.[jt]sx?$/, /_spec\.[jt]sx?$/,
];
```

**Go:** `/_test\.go$/`

### 10.2 Test Runners (lines 61–65)

```typescript
const SCOPEABLE_RUNNERS = {
  vitest: ["run", ...files],
  jest: ["--", ...files],
  mocha: [...files],
};
```

**Go equivalent:**

```typescript
"go": ["test", ...packages]  // go test ./pkg/handler ./pkg/service
// Or for all: go test ./...
```

### 10.3 Test Directory Candidates (lines 71–75)

```typescript
const TEST_DIR_CANDIDATES = ["__tests__", "tests", "test"];
```

**Go:** Tests live alongside source in the same package directory. No separate test directory convention. The `testdata/` directory holds test fixtures.

---

## 11. LLM Prompts & Generators

### 11.1 CONTEXT.md Generator

**File:** `packages/sourcevision/src/generators/context.ts`

Generates the `.sourcevision/CONTEXT.md` file for LLM consumption. References zone names, file roles, and import graphs — all language-agnostic in format. The content will naturally reflect Go idioms once the analyzers produce Go-aware data.

### 11.2 Classification Prompts

**File:** `packages/sourcevision/src/analyzers/classify.ts`

The `buildLLMClassifyPrompt()` function references archetypes by ID. Once Go-appropriate archetypes exist, the classification prompt automatically picks them up.

### 11.3 Enrichment Prompts

**File:** `packages/sourcevision/src/analyzers/enrich-config.ts`

Pass-specific focus strings reference "framework convention route modules (Remix/React Router)". These would need Go-equivalent context strings for Go projects.

---

## 12. Configuration — .n-dx.json

The project-level config has no `language` field. Adding one would enable language-aware behavior:

```json
{
  "language": "go",
  "sourcevision": { ... },
  "rex": { ... },
  "hench": {
    "guard": {
      "allowedCommands": ["go", "make", "git", "golangci-lint"]
    }
  }
}
```

**Alternatively:** Auto-detect language from project markers:
- `go.mod` present → Go project
- `package.json` present → JS/TS project
- Both present → mixed (e.g., Go backend + JS frontend)

---

## 13. Summary: Change Inventory

### Must Change (Go support broken without these)

| # | Area | File(s) | Effort | Description |
|---|------|---------|--------|-------------|
| 1 | Import parsing | `imports.ts` | Medium | Add Go import extraction (regex or `go list`) |
| 2 | Extension gates | `imports.ts`, `callgraph.ts`, `server-route-detection.ts`, `components.ts` | Low | Add `.go` to parseable extension sets |
| 3 | Test patterns | `scanners.ts` (rex), `test-runner.ts` (hench) | Low | Add `_test.go` patterns |
| 4 | Allowed commands | Hench config schema/defaults | Low | Add `go`, `make` to defaults |

### Should Change (significantly better Go experience)

| # | Area | File(s) | Effort | Description |
|---|------|---------|--------|-------------|
| 5 | Archetype patterns | `archetypes.ts` | Medium | Add `.go` extension variants and Go-specific archetypes |
| 6 | Skip directories | `inventory.ts`, `scanners.ts` | Low | Add `vendor/` |
| 7 | Config detection | `inventory.ts` | Low | Add `go.mod`, `go.sum`, `.golangci.yml` to config filenames |
| 8 | Go route detection | `server-route-detection.ts` | Medium | Detect chi/gin/echo/fiber route patterns |
| 9 | Package scanner | `scanners.ts` (rex) | Medium | Parse `go.mod` for dependencies and module info |
| 10 | Language detection | `.n-dx.json` schema | Low | Add language field or auto-detection |

### Can Defer (nice to have for v2)

| # | Area | File(s) | Effort | Description |
|---|------|---------|--------|-------------|
| 11 | Call graph | `callgraph.ts` | High | Go function/method call graph via regex or `go/ast` |
| 12 | Interface catalog | New analyzer | High | Catalog Go interfaces and their implementations |
| 13 | Go-specific findings | New finding rules | Medium | Detect Go anti-patterns (large interfaces, package cycles) |
| 14 | Mixed-language support | Multiple | High | Projects with both Go and JS/TS (e.g., fullstack monorepos) |

---

## 14. Key Architectural Decisions Required

1. **Language detection strategy:** Explicit config vs auto-detect vs hybrid?
2. **Go AST parsing:** Regex-only vs shell out to `go list` vs bundle a Go binary?
3. **Archetype system:** Per-language overlay files vs language field on signals vs runtime filtering?
4. **Component analyzer:** Skip entirely for Go or repurpose for interface/struct cataloging?
5. **Mixed-language projects:** Support in v1 or defer?

---

## Appendix A: Go Project Conventions

Standard Go project layout (not enforced, but widely adopted):

```
project/
  cmd/              # CLI entry points (each subdir = one binary)
    api/main.go
    worker/main.go
  internal/         # Private application code (not importable by external modules)
    handler/
    service/
    repository/
    middleware/
  pkg/              # Public library code (importable by external consumers)
  api/              # OpenAPI specs, protobuf definitions
  web/              # Frontend assets (if fullstack)
  configs/          # Configuration file templates
  scripts/          # Build/install/analysis scripts
  deployments/      # Docker, k8s, terraform configs
  migrations/       # Database migration files
  go.mod            # Module definition
  go.sum            # Dependency checksums
  Makefile          # Build targets
```

## Appendix B: Go Import Syntax Reference

```go
// Single import
import "fmt"

// Grouped imports
import (
    "context"
    "fmt"
    "net/http"

    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"

    "github.com/myorg/myproject/internal/handler"
    "github.com/myorg/myproject/internal/service"
)

// Named import (alias)
import myalias "github.com/long/package/path"

// Blank import (side effects only)
import _ "github.com/lib/pq"

// Dot import (imports into current namespace — rare, discouraged)
import . "fmt"
```

**Import categorization by convention (goimports enforced):**
1. Standard library (`fmt`, `net/http`, `context`)
2. Third-party (`github.com/...`, `golang.org/x/...`)
3. Internal (`<module-path>/internal/...`, `<module-path>/pkg/...`)

## Appendix C: Go HTTP Handler Signatures

```go
// Standard library
func handler(w http.ResponseWriter, r *http.Request) { ... }
http.HandleFunc("/path", handler)
http.Handle("/path", http.HandlerFunc(handler))

// chi
r := chi.NewRouter()
r.Get("/users/{id}", getUser)
r.Route("/api", func(r chi.Router) {
    r.Use(middleware.Logger)
    r.Get("/users", listUsers)
})

// gin
r := gin.Default()
r.GET("/users/:id", getUser)
r.Group("/api").GET("/users", listUsers)

// echo
e := echo.New()
e.GET("/users/:id", getUser)
g := e.Group("/api")
g.GET("/users", listUsers)

// fiber
app := fiber.New()
app.Get("/users/:id", getUser)
api := app.Group("/api")
api.Get("/users", listUsers)
```
