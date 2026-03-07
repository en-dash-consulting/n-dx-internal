## Summary

**Branch:** `feature/sv-fixes-0306`
**Base:** `main`
**Completed items:** 24

## ⚠️ Breaking Changes

- **Address relationship issues (5 findings)**
  - Hench is the only execution-layer package importing from a domain package (rex via gateway); if rex's public API changes, hench's gateway is the single choke-point — this is good design, but the gateway has no explicit version-lock or compatibility test to catch breaking changes early.
- Cross-zone import direction 'dom → web-viewer' conflicts with documented leaf-node status; verify whether dom-performance-monitoring imports anything from web-viewer or whether the arrow direction in the import table denotes 'exports to'. If dom does import from web-viewer, this is a circular dependency that must be resolved.
- Orchestration layer's zero-coupling guarantee is enforced structurally but not contractually — CLI argument interfaces between cli.js and domain package CLIs are untyped; adding schema validation or contract tests would make the spawn boundary explicit.
- viewer-static-assets has zero import-graph coupling but carries hidden deployment coupling to web-dashboard via build manifest filenames; this contract is not enforced by TypeScript and breaks silently if build output names change.
- boundary-check.test.ts appears to test zone-boundary contracts rather than websocket internals; relocating it to an integration test zone would remove the external coupling that degrades this zone's cohesion score.
- **Address anti-pattern issues (13 findings)**
  - rex-gateway.ts in hench re-exports 8 functions from rex with no version-lock or compatibility smoke test; breaking changes to rex's public API will only surface at runtime inside an agent loop, making them expensive to diagnose — add a gateway compatibility test
- Call graph reports coupling=0 while cross-zone import table records 1 outgoing import to web-viewer — metric disagreement between analysis passes produces unreliable zone health scores and must be resolved before coupling data can be trusted for this zone.
- MCP HTTP transport (the recommended integration path) has no E2E test coverage; the suite tests CLI process boundaries but not the HTTP session lifecycle, leaving the primary MCP surface unvalidated at the process boundary level.
- No shared E2E fixture or helper module detected across 14 test files; duplicated process-spawn and environment setup logic increases maintenance burden and risks inconsistent test environments between files — extract common setup into a shared e2e-helpers module.
- architecture-policy.test.js encodes zone IDs and tier boundaries statically; zone renames or structural changes will not automatically invalidate the policy assertions, creating a category of silent false-passes — tie policy checks to the live zone graph output rather than hardcoded identifiers.
- CLI argument interfaces between orchestration scripts and domain package CLIs are untyped; any CLI signature change in rex, hench, or sourcevision is a silent breaking change with no compile-time or schema-level safety net — add contract tests or a shared CLI-args schema to make this boundary explicit
- usage-cleanup-scheduler.ts depends on web-viewer (the UI application layer) from within a background service zone — scheduler lifecycle should be driven by an interface or event emitter, not a direct import of the viewer module, to prevent initialization-order coupling in tests and production startup
- No shared design-token layer exists between viewer-static-assets and web-landing despite both being presentation zones in the same package; brand drift between landing page and viewer is undetectable at build time
- elapsed-time.ts and task-audit.ts are reusable UI components but are grouped with build scripts and package assets in the web-build-infrastructure zone — they should be moved to the web-viewer zone or a dedicated components zone to collocate them with their consumers and avoid accidental coupling to build tooling
- Absence of a dedicated test-support or shared-fixtures zone forces web-viewer tests to import from the low-cohesion web-unit zone (6 imports); introducing a scoped test-support module would break this dependency and allow web-unit to be dissolved or tightened
- 2 production files (websocket.ts, ws-health-tracker.ts) do not justify an independent zone boundary; absorbing them into web-dashboard would eliminate the structural noise introduced by the test-inflated coupling metric
- God function: cmdAnalyze in packages/rex/src/cli/commands/analyze.ts calls 44 unique functions — consider decomposing into smaller, focused functions
- God function: runConfig in config.js calls 36 unique functions — consider decomposing into smaller, focused functions
- **Add CLI argument contract tests**
  CLI argument interfaces between orchestration scripts and domain package CLIs are untyped. Add contract tests that verify CLI help output matches expected argument signatures, catching silent breaking changes.
  - Contract test validates rex, hench, sourcevision CLI signatures
  - Test breaks when CLI args change without updating contract
  - Covers at least the top-level commands

## Major Changes

- **Address suggestion issues (17 findings)** [critical]
  - Run intra-package call-graph analysis on hench to detect any emerging circular call patterns between its internal subdirectories (agent/, prd/, tools/) before they compound — the rex circular call pattern (239+100 calls) was only found via call-graph analysis, not zone metrics, and hench's 2838 internal calls make it the most likely next site for a hidden cycle.
- Add a dependency-cruiser or similar import-boundary rule to CI that enforces the gateway pattern: any cross-package import that does not pass through the designated gateway module should fail the build. This converts a trust-based convention into a machine-enforced constraint.
- All micro-zones (< 5 production files) in the web package lack facade index modules, meaning their zone boundaries exist only in the zone detection metadata and are invisible to the TypeScript compiler — mandate an 'index.ts' barrel for every zone with 2+ production files to make zone membership compiler-visible and reduce the risk of zone boundaries eroding silently.
- Establish a documented testing convention for the utility+hook pattern: every hook wrapper (use-*.ts) should have a corresponding hook test file alongside the utility test — currently dom-performance-monitoring applies the production pattern but not the test pattern, and without a written convention future hooks will follow the same incomplete template.
- Introduce a project-wide lint rule enforcing that files in 'src/server/' cannot import from 'src/viewer/' — the two known violations (task-usage-tracking, websocket boundary-check) both evade detection because the no-upward-import convention is undocumented and unenforced; a lint rule would surface new violations at PR time rather than zone-enrichment time.
- Reconcile the two analysis passes (call-graph and cross-zone import table) that report contradictory coupling values for the dom zone — add a CI step that asserts zone IDs are consistent across both passes and flags any zone that appears in one pass but not the other, before this class of metric disagreement spreads to other zones.
- 5 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): packages-rex:unit-core, packages-rex:unit-cli, websocket-infrastructure, packages-sourcevision:analyzers-3, packages-rex:unit — mandatory refactoring recommended before further development
- Split the web-build-infrastructure zone into two groups: (1) build tooling (build.js, dev.js, package.json, images, markdown) and (2) reusable UI components (elapsed-time.ts, task-audit.ts) — these two groups have different change drivers, different consumers, and different lifecycle concerns that should not share a zone boundary.
- Add use-dom-performance-monitor.test.ts to cover the hook's lifecycle: verify the monitor is started on mount, stopped on unmount, and that ref changes trigger re-subscription — the utility has test coverage but the hook wrapper that most consumers interact with does not.
- Document the execution log rotation policy (max file size, max file count, rotation trigger) in .rex/config.json or a companion README to prevent unbounded log accumulation and clarify when execution-log.1.jsonl vs execution-log.jsonl is the authoritative current log.
- Neither source file in this zone exports through a shared index — introduce a thin 'index.ts' barrel that re-exports the public surfaces of both services, giving the zone an explicit boundary and preventing consumers from coupling to internal file paths.
- websocket-infrastructure breaches both cohesion (<0.5) and coupling (>0.5) thresholds simultaneously — this double breach qualifies it as the highest-priority structural risk in the web package; dissolve the zone by absorbing websocket.ts and ws-health-tracker.ts into web-dashboard and relocating boundary-check.test.ts to the integration test suite.
- Zone "WebSocket Infrastructure" (websocket-infrastructure) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention
- Zone "Unit Core" (packages-rex:unit-core) has catastrophic risk (score: 0.83, cohesion: 0.17, coupling: 0.83) — requires immediate architectural intervention
- Zone "Unit Cli" (packages-rex:unit-cli) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention
- Zone "Analyzers 3" (packages-sourcevision:analyzers-3) has critical risk (score: 0.69, cohesion: 0.31, coupling: 0.69) — requires refactoring before new feature development
- Zone "Unit" (packages-rex:unit) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development

## Completed Work

### (Ungrouped)

**Address anti-pattern issues (13 findings)**
- ⚠️ **Add CLI argument contract tests**
  CLI argument interfaces between orchestration scripts and domain package CLIs are untyped. Add contract tests that verify CLI help output matches expected argument signatures, catching silent breaking changes.
  - Contract test validates rex, hench, sourcevision CLI signatures
  - Test breaks when CLI args change without updating contract
  - Covers at least the top-level commands
- Add gateway compatibility test for hench rex-gateway
  rex-gateway.ts in hench re-exports 8+ functions from rex with no version-lock or compatibility smoke test. Add a test that verifies all re-exported functions exist and are callable, so rex API changes are caught at test time rather than at runtime inside agent loops.
  - Gateway compatibility test exists in hench test suite
  - Test verifies all re-exported functions are defined and callable
  - Test fails if any re-exported function is removed from rex public API
- Extract shared E2E test helpers module
  No shared E2E fixture or helper module across 14 test files. Extract common process-spawn, environment setup, and cleanup logic into a shared e2e-helpers module to reduce duplication and ensure consistent test environments.
  - Shared e2e-helpers module exists in tests/e2e/
  - Common spawn/setup patterns extracted from existing tests
  - At least 3 existing test files updated to use shared helpers
- Decompose cmdAnalyze god function
  cmdAnalyze in packages/rex/src/cli/commands/analyze.ts calls 44 unique functions. Decompose into smaller, focused phases (config resolution, scanning, proposal processing, acceptance).
  - cmdAnalyze broken into named sub-functions
  - Each extracted function has a clear single responsibility
  - Existing tests continue to pass
- Decompose runConfig god function
  runConfig in config.js calls 36 unique functions. Decompose into smaller, focused functions for each config section handler.
  - runConfig broken into named sub-functions
  - Each section handler is its own function
  - Existing tests continue to pass
- Fix usage-cleanup-scheduler web-viewer coupling
- Move elapsed-time.ts and task-audit.ts to viewer zone
- Absorb websocket zone into web-dashboard
- Tie architecture policy test to live zone graph

**Address relationship issues (5 findings)**
- Verify dom→web-viewer cross-zone import direction is not circular
  Finding #2: Cross-zone import direction 'dom → web-viewer' conflicts with documented leaf-node status. Verify the import direction and document/resolve.
- Add CLI spawn boundary contract tests
  Finding #3: Orchestration layer's zero-coupling guarantee is enforced structurally but not contractually. Add contract tests that verify each domain CLI accepts the expected arguments and returns expected exit codes.
- Add viewer build output contract assertion
  Finding #4: viewer-static-assets has hidden deployment coupling to web-dashboard via build manifest filenames. Add a contract test that verifies expected build outputs exist after build.
- Relocate boundary-check.test.ts to integration tests

**Address suggestion issues (17 findings)**
- Add gateway pattern import boundary enforcement to CI
  Add an eslint rule or custom CI check that enforces the gateway pattern: any cross-package runtime import that does not pass through the designated gateway module should fail the build. Also add a rule preventing src/server/ from importing src/viewer/ in the web package. Covers findings: gateway pattern CI enforcement, server/viewer import boundary.
  - CI step validates that cross-package imports only go through gateway modules
  - ESLint or custom rule prevents packages/web/src/server/ from importing packages/web/src/viewer/
  - Existing code passes the new rules (no false positives)
- Add use-dom-performance-monitor hook test and document utility+hook testing convention
  Write use-dom-performance-monitor.test.ts covering hook lifecycle: monitor started on mount, stopped on unmount, ref changes trigger re-subscription. Document the testing convention for utility+hook pattern in PACKAGE_GUIDELINES.md.
  - use-dom-performance-monitor.test.ts exists with mount/unmount/ref-change tests
  - PACKAGE_GUIDELINES.md documents the utility+hook testing convention
  - Tests pass in CI
- Address high-risk zone metrics (5 zones exceeding thresholds)
  Address the 5 zones exceeding architectural risk thresholds: packages-rex:unit-core (0.83 risk), packages-rex:unit-cli (0.75 risk), websocket-infrastructure (0.75 risk), packages-sourcevision:analyzers-3 (0.69 risk), packages-rex:unit (0.67 risk). Dissolve websocket-infrastructure by absorbing into web-dashboard. Split web-build-infrastructure into build tooling and UI components. Investigate and refactor rex zones for better cohesion/coupling.
  - websocket-infrastructure zone dissolved into web-dashboard
  - web-build-infrastructure split into build tooling and UI components
  - All 5 high-risk zones show improved metrics or have documented justification for current structure
- Add barrel index.ts for web micro-zones and dom-performance-monitoring zone
- Document execution log rotation policy
- Hench call-graph analysis and analysis pass reconciliation

- 🔶 **Address suggestion issues (17 findings)** *(feature)*
  - Run intra-package call-graph analysis on hench to detect any emerging circular call patterns between its internal subdirectories (agent/, prd/, tools/) before they compound — the rex circular call pattern (239+100 calls) was only found via call-graph analysis, not zone metrics, and hench's 2838 internal calls make it the most likely next site for a hidden cycle.
- Add a dependency-cruiser or similar import-boundary rule to CI that enforces the gateway pattern: any cross-package import that does not pass through the designated gateway module should fail the build. This converts a trust-based convention into a machine-enforced constraint.
- All micro-zones (< 5 production files) in the web package lack facade index modules, meaning their zone boundaries exist only in the zone detection metadata and are invisible to the TypeScript compiler — mandate an 'index.ts' barrel for every zone with 2+ production files to make zone membership compiler-visible and reduce the risk of zone boundaries eroding silently.
- Establish a documented testing convention for the utility+hook pattern: every hook wrapper (use-*.ts) should have a corresponding hook test file alongside the utility test — currently dom-performance-monitoring applies the production pattern but not the test pattern, and without a written convention future hooks will follow the same incomplete template.
- Introduce a project-wide lint rule enforcing that files in 'src/server/' cannot import from 'src/viewer/' — the two known violations (task-usage-tracking, websocket boundary-check) both evade detection because the no-upward-import convention is undocumented and unenforced; a lint rule would surface new violations at PR time rather than zone-enrichment time.
- Reconcile the two analysis passes (call-graph and cross-zone import table) that report contradictory coupling values for the dom zone — add a CI step that asserts zone IDs are consistent across both passes and flags any zone that appears in one pass but not the other, before this class of metric disagreement spreads to other zones.
- 5 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): packages-rex:unit-core, packages-rex:unit-cli, websocket-infrastructure, packages-sourcevision:analyzers-3, packages-rex:unit — mandatory refactoring recommended before further development
- Split the web-build-infrastructure zone into two groups: (1) build tooling (build.js, dev.js, package.json, images, markdown) and (2) reusable UI components (elapsed-time.ts, task-audit.ts) — these two groups have different change drivers, different consumers, and different lifecycle concerns that should not share a zone boundary.
- Add use-dom-performance-monitor.test.ts to cover the hook's lifecycle: verify the monitor is started on mount, stopped on unmount, and that ref changes trigger re-subscription — the utility has test coverage but the hook wrapper that most consumers interact with does not.
- Document the execution log rotation policy (max file size, max file count, rotation trigger) in .rex/config.json or a companion README to prevent unbounded log accumulation and clarify when execution-log.1.jsonl vs execution-log.jsonl is the authoritative current log.
- Neither source file in this zone exports through a shared index — introduce a thin 'index.ts' barrel that re-exports the public surfaces of both services, giving the zone an explicit boundary and preventing consumers from coupling to internal file paths.
- websocket-infrastructure breaches both cohesion (<0.5) and coupling (>0.5) thresholds simultaneously — this double breach qualifies it as the highest-priority structural risk in the web package; dissolve the zone by absorbing websocket.ts and ws-health-tracker.ts into web-dashboard and relocating boundary-check.test.ts to the integration test suite.
- Zone "WebSocket Infrastructure" (websocket-infrastructure) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention
- Zone "Unit Core" (packages-rex:unit-core) has catastrophic risk (score: 0.83, cohesion: 0.17, coupling: 0.83) — requires immediate architectural intervention
- Zone "Unit Cli" (packages-rex:unit-cli) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention
- Zone "Analyzers 3" (packages-sourcevision:analyzers-3) has critical risk (score: 0.69, cohesion: 0.31, coupling: 0.69) — requires refactoring before new feature development
- Zone "Unit" (packages-rex:unit) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development
- ⚠️ **Address relationship issues (5 findings)** *(feature)*
  - Hench is the only execution-layer package importing from a domain package (rex via gateway); if rex's public API changes, hench's gateway is the single choke-point — this is good design, but the gateway has no explicit version-lock or compatibility test to catch breaking changes early.
- Cross-zone import direction 'dom → web-viewer' conflicts with documented leaf-node status; verify whether dom-performance-monitoring imports anything from web-viewer or whether the arrow direction in the import table denotes 'exports to'. If dom does import from web-viewer, this is a circular dependency that must be resolved.
- Orchestration layer's zero-coupling guarantee is enforced structurally but not contractually — CLI argument interfaces between cli.js and domain package CLIs are untyped; adding schema validation or contract tests would make the spawn boundary explicit.
- viewer-static-assets has zero import-graph coupling but carries hidden deployment coupling to web-dashboard via build manifest filenames; this contract is not enforced by TypeScript and breaks silently if build output names change.
- boundary-check.test.ts appears to test zone-boundary contracts rather than websocket internals; relocating it to an integration test zone would remove the external coupling that degrades this zone's cohesion score.
- ⚠️ **Address anti-pattern issues (13 findings)** *(feature)*
  - rex-gateway.ts in hench re-exports 8 functions from rex with no version-lock or compatibility smoke test; breaking changes to rex's public API will only surface at runtime inside an agent loop, making them expensive to diagnose — add a gateway compatibility test
- Call graph reports coupling=0 while cross-zone import table records 1 outgoing import to web-viewer — metric disagreement between analysis passes produces unreliable zone health scores and must be resolved before coupling data can be trusted for this zone.
- MCP HTTP transport (the recommended integration path) has no E2E test coverage; the suite tests CLI process boundaries but not the HTTP session lifecycle, leaving the primary MCP surface unvalidated at the process boundary level.
- No shared E2E fixture or helper module detected across 14 test files; duplicated process-spawn and environment setup logic increases maintenance burden and risks inconsistent test environments between files — extract common setup into a shared e2e-helpers module.
- architecture-policy.test.js encodes zone IDs and tier boundaries statically; zone renames or structural changes will not automatically invalidate the policy assertions, creating a category of silent false-passes — tie policy checks to the live zone graph output rather than hardcoded identifiers.
- CLI argument interfaces between orchestration scripts and domain package CLIs are untyped; any CLI signature change in rex, hench, or sourcevision is a silent breaking change with no compile-time or schema-level safety net — add contract tests or a shared CLI-args schema to make this boundary explicit
- usage-cleanup-scheduler.ts depends on web-viewer (the UI application layer) from within a background service zone — scheduler lifecycle should be driven by an interface or event emitter, not a direct import of the viewer module, to prevent initialization-order coupling in tests and production startup
- No shared design-token layer exists between viewer-static-assets and web-landing despite both being presentation zones in the same package; brand drift between landing page and viewer is undetectable at build time
- elapsed-time.ts and task-audit.ts are reusable UI components but are grouped with build scripts and package assets in the web-build-infrastructure zone — they should be moved to the web-viewer zone or a dedicated components zone to collocate them with their consumers and avoid accidental coupling to build tooling
- Absence of a dedicated test-support or shared-fixtures zone forces web-viewer tests to import from the low-cohesion web-unit zone (6 imports); introducing a scoped test-support module would break this dependency and allow web-unit to be dissolved or tightened
- 2 production files (websocket.ts, ws-health-tracker.ts) do not justify an independent zone boundary; absorbing them into web-dashboard would eliminate the structural noise introduced by the test-inflated coupling metric
- God function: cmdAnalyze in packages/rex/src/cli/commands/analyze.ts calls 44 unique functions — consider decomposing into smaller, focused functions
- God function: runConfig in config.js calls 36 unique functions — consider decomposing into smaller, focused functions
- Address observation issues (8 findings) *(feature)*
  - Bidirectional coupling: "task-usage-tracking" ↔ "web-dashboard" (1+3 crossings) — consider extracting shared interface
- Bidirectional coupling: "web-build-infrastructure" ↔ "web-dashboard" (4+2 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects
- Low cohesion (0.25) — files are loosely related, consider splitting this zone
- Cohesion of 0.25 and coupling of 0.75 indicate significant structural fragmentation — likely caused by test files importing broadly from the rest of the web package.
- Only 2 of 6 files are production source; the test-to-source ratio inflates coupling scores and suggests the zone boundary is defined by test co-location rather than domain cohesion.
- The cleanup scheduler imports back into web-viewer (per cross-zone import graph), creating a dependency inversion — the scheduler should depend on an interface, not the viewer zone.
- Bidirectional imports between web and web-viewer (web→web-viewer: 4, web-viewer→web: 2) create a soft cycle risk; extracting shared primitives into a dedicated shared zone would eliminate this.
- Address pattern issues (4 findings) *(feature)*
  - E2E suite has zero source-level coupling but a hidden build-time dependency on all packages; CI must enforce a build step before e2e execution. This should be documented or enforced via a pre-test script to prevent silent false-negatives when a package fails to compile.
- The runtime-state zone is a shared mutable sink readable by both rex and hench packages without creating import-graph coupling — this is an intentional design but concurrent write safety is implicit; documenting the write-access protocol would prevent future race conditions.
- Absence of an index/facade module means task-usage-tracking has no encapsulated public surface; consumers couple directly to internal service files, weakening the zone boundary.
- Build scripts (build.js, dev.js) in this zone operate at the package boundary but are grouped with UI components (elapsed-time.ts, task-audit.ts) — splitting into a pure build-config group and a reusable-components group would clarify which files are tooling versus production API surface.

