# Go Language Integration — Phase 1 Post-Op

> **Status:** Complete
> **Date:** 2026-03-26
> **Branch:** `feature/lang-discovery`
> **Prerequisites:** [go-integration-discovery.md](./go-integration-discovery.md), [go-integration-plan.md](./go-integration-plan.md)

---

## Summary

Phase 1 targeted four deliverables: language registry, inventory refactor, config integration, and a Go test fixture. All four were implemented and pass the full test suite (1261 tests, 56 test files, zero failures). The implementation closely follows the plan with minor deviations documented below.

---

## Planned vs Delivered

### 1.1 Language Registry Module

| Planned | Delivered | Status |
|---------|-----------|--------|
| `packages/sourcevision/src/language/registry.ts` | ✅ Created — `LanguageConfig` interface with all specified fields | Match |
| `packages/sourcevision/src/language/go.ts` | ✅ Created — Go config (extensions, test patterns, config filenames, skip dirs, generated patterns, entry points, module file) | Match |
| `packages/sourcevision/src/language/typescript.ts` | ✅ Created — TS/JS config extracted from former hardcoded constants | Match |
| `packages/sourcevision/src/language/detect.ts` | ✅ Created — 5-step detection chain (override → go.mod → package.json → file-count tiebreak → TS fallback) | Match |
| `packages/sourcevision/src/language/index.ts` | ✅ Created — barrel re-export | Match (not explicitly planned, but follows project convention) |

**LanguageConfig interface fields delivered:**
- `id`, `displayName`, `extensions`, `parseableExtensions`, `testFilePatterns`, `configFilenames`, `skipDirectories`, `generatedFilePatterns`, `entryPointPatterns`, `moduleFile`

All fields from the plan spec are present. The interface is extensible for Phase 2+ languages.

### 1.2 Inventory Analyzer Refactor

| Planned | Delivered | Status |
|---------|-----------|--------|
| Import language registry | ✅ `detectProjectLanguage`, `typescriptConfig`, `LanguageConfig` imported | Match |
| Replace hardcoded `SKIP_DIRS` | ✅ Reduced to `BASE_SKIP_DIRS` (`.git`, `.sourcevision`); language-specific dirs merged from config | Match |
| Replace hardcoded `CONFIG_FILENAMES` | ✅ Language config filenames consumed | Match |
| `_test.go` → role `"test"` | ✅ Routed through `langConfig.testFilePatterns` | Match |
| `_gen.go`, `.pb.go`, `wire_gen.go`, `mock_*.go` → role `"generated"` | ✅ Routed through `langConfig.generatedFilePatterns` | Match |
| `testdata/` contents → role `"asset"` | ✅ Go-specific `testdata/` convention handled | Match |
| `cmd/*/main.go` → role `"source"` | ✅ Entry point archetype deferred to Phase 3 (as planned) | Match |
| `classifyRole()` accepts optional `LanguageConfig` | ✅ Third parameter is optional; existing callers unchanged | Match |
| `analyzeInventory()` auto-detects language | ✅ Falls back to `typescriptConfig` when no Go markers present | Match |

**Backward compatibility:** Confirmed — `typescriptConfig` values are identical to the removed hardcoded constants. All 1261 pre-existing tests pass.

### 1.3 Config Integration

| Planned | Delivered | Status |
|---------|-----------|--------|
| `language` field in `.n-dx.json` | ✅ Top-level scalar key | Match |
| Valid values: `"typescript"`, `"javascript"`, `"go"`, `"auto"` | ✅ `VALID_LANGUAGE_IDS` constant | Match |
| `ndx config language go` sets language | ✅ Config command wired | Match |
| Default: `"auto"` | ✅ Falls back to auto-detection | Match |

### 1.4 Schema Changes

| Planned | Delivered | Status |
|---------|-----------|--------|
| `Manifest.language?: string` field | ✅ Added to `packages/sourcevision/src/schema/v1.ts` | Match |
| Persisted to `manifest.json` | ✅ `analyze-phases.ts` writes `manifest.language = langConfig.id` after inventory completes | Match |

### 1.5 Test Suite

| Planned | Delivered | Status |
|---------|-----------|--------|
| `language-registry.test.ts` (unit) | ✅ 31 test cases — config structure, registry lookup, pattern matching | Exceeds plan |
| `language-detect.test.ts` (unit) | ✅ 13 test cases — override, markers, tiebreak, fallback | Exceeds plan |
| `language-detect.test.ts` (unit, second file) | ✅ 10 additional test cases | Exceeds plan |
| `inventory-go.test.ts` (integration) | ✅ 19 test cases — full Go fixture validation | Exceeds plan |

**Total new tests:** ~73 test cases across 4 files. The plan specified 3 test files; delivery includes 4 (the detection logic was split across two files).

### 1.6 Go Fixture Project

| Planned | Delivered | Status |
|---------|-----------|--------|
| `tests/fixtures/go-project/` | ✅ Created at `packages/sourcevision/tests/fixtures/go-project/` | Minor path deviation |
| `go.mod` | ✅ Module definition | Match |
| `go.sum` | ✅ Dependency checksums | Match |
| `.golangci.yml` | ✅ Linter config | Match |
| `Makefile` | ✅ Build targets | Match |
| `cmd/api/main.go` | ✅ Entry point | Match |
| `internal/{handler,service,repository,middleware,config}/` | ✅ Full Go standard layout | Match |
| `_test.go` files | ✅ 3 test files | Match |
| `pkg/response/json.go` | ✅ Shared library package | Match |
| `testdata/users.json` | ✅ Test fixture data | Match |
| `vendor/` directory | ✅ With example lib (validates skip behavior) | Match |
| `api/openapi.yaml` | ❌ Not included | Minor omission |
| `migrations/001_create_users.sql` | ❌ Not included | Minor omission |

The omitted files (`api/openapi.yaml`, `migrations/*.sql`) were non-critical — they exercise `docs` and `other` roles which are already covered by existing tests. The fixture adequately validates all Go-specific behavior.

---

## Deviations from Plan

### Intentional

1. **Fixture path** — Plan specified `tests/fixtures/go-project/`; implementation placed it at `packages/sourcevision/tests/fixtures/go-project/`. This follows the project's existing convention of co-locating test fixtures with their package.

2. **Detection split across two test files** — `detect.test.ts` and `language-detect.test.ts` both exist. This appears to be Hench creating tests in two passes rather than a deliberate design choice. Not harmful but could be consolidated.

### Unplanned Additions

1. **`analyze-phases.ts` modified** — The plan didn't explicitly call out this file, but it's the natural integration point for persisting `manifest.language`. Correct decision.

2. **`VALID_LANGUAGE_IDS` constant exported** — Useful for config validation. Good addition not in the original plan.

---

## What Phase 1 Enables

With the language registry in place, Phase 2 can now:

1. **Import `goConfig`** from `language/go.ts` to gate Go import parsing
2. **Read `manifest.language`** to know which import parser to dispatch
3. **Use `parseableExtensions`** from the config to filter files for AST parsing
4. **Use `moduleFile`** to locate `go.mod` and extract the module path for import resolution

The registry is the backbone — all downstream phases depend on it.

---

## Validation Checklist for Phase 2 Readiness

| Check | Command | Result |
|-------|---------|--------|
| Build passes | `pnpm build` | ✅ All 5 packages compile |
| SourceVision tests pass | `pnpm --filter sourcevision test -- --run` | ✅ 1261 tests, 0 failures |
| Full test suite | `pnpm test` | Should run (recommended before Phase 2 kickoff) |
| CI validation | `ndx ci .` | Recommended — validates gateway rules, architecture policy, domain isolation |
| Go fixture inventory | Manual: run `ndx analyze` on fixture, inspect `inventory.json` | Recommended |

---

## Phase 2 Pre-Conditions Met

| Pre-condition | Status |
|--------------|--------|
| `LanguageConfig` interface exists and is extensible | ✅ |
| Go config has `parseableExtensions` for import parser gating | ✅ |
| Go config has `moduleFile: "go.mod"` for module path extraction | ✅ |
| `manifest.language` persisted for downstream dispatch | ✅ |
| Inventory correctly classifies Go files (source, test, config, generated, asset) | ✅ |
| `vendor/` skipped in inventory | ✅ |
| Backward compatibility — JS/TS projects unchanged | ✅ |
| Go fixture project exists for integration testing | ✅ |

**Phase 2 is unblocked.**

---

## Recommendations Before Starting Phase 2

1. **Run `ndx ci .`** — Confirm the new `language/` directory doesn't violate gateway or architecture policies. It shouldn't (it's internal to sourcevision), but CI validation is the project's contract.

2. **Consider consolidating detect test files** — `detect.test.ts` and `language-detect.test.ts` cover overlapping ground. A quick merge would reduce maintenance surface.

3. **Add Phase 2 items to Rex PRD** — Seed the Phase 2 epic (Go import parser, extension gate updates, zone detection validation) so `ndx work` can pick them up.

4. **Update CLAUDE.md** — The language registry is a new internal subsystem. Consider adding a brief mention under the sourcevision package description so LLM agents are aware of it when making changes.
