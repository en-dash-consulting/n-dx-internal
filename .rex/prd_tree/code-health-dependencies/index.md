---
id: "6a128173-0145-42a0-99bb-54308b9c0ec1"
level: "epic"
title: "Code Health & Dependencies"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-19T03:24:10.418Z"
completedAt: "2026-04-19T03:24:10.418Z"
description: "Automated recommendations from SourceVision analysis. 26 zone+category groups covering 33 total findings.\n\n---\n\nAutomated recommendations from SourceVision analysis. 10 zone+category groups covering 11 total findings.\n\n---\n\nAutomated recommendations from SourceVision analysis. 14 zone+category groups covering 14 total findings.\n\n---\n\nAutomated recommendations from SourceVision analysis. 24 zone+category groups covering 43 total findings.\n\n---\n\nAutomated recommendations from SourceVision analysis. 4 zone+category groups covering 5 total findings."
recommendationMeta: "[object Object]"
---

# Code Health & Dependencies

🟠 [completed]

## Summary

Automated recommendations from SourceVision analysis. 26 zone+category groups covering 33 total findings.

---

Automated recommendations from SourceVision analysis. 10 zone+category groups covering 11 total findings.

---

Automated recommendations from SourceVision analysis. 14 zone+category groups covering 14 total findings.

---

Automated recommendations from SourceVision analysis. 24 zone+category groups covering 43 total findings.

---

Automated recommendations from SourceVision analysis. 4 zone+category groups covering 5 total findings.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Audit and remediate deprecated npm dependencies across all monorepo packages | task | completed | 2026-04-08 |
| Fix anti-pattern in global: God function: runCommand in packages/core/cli.js calls 38 unique functions — con | task | completed | 2026-04-20 |
| Fix anti-pattern in global: God function: analyzeImports in packages/sourcevision/src/analyzers/imports.ts c (+1 more) | task | completed | 2026-04-16 |
| Fix anti-pattern in global: God function: handleInit in packages/core/cli.js calls 40 unique functions — con | task | completed | 2026-04-17 |
| Fix code in global: Establish a satellite zone testing policy requiring every production file in a s (+3 more) | task | completed | 2026-04-14 |
| Fix code in packages-web:integration: search-overlay.ts is missing from the PANEL_FILES constant in boundary-check.tes (+1 more) | task | completed | 2026-04-14 |
| Fix code in prd-tree-search: SearchFacets now has three canonical import paths after the prd-tree/index.ts ba (+1 more) | task | completed | 2026-04-14 |
| Fix code in project-scaffold: cli-brand.js exists at both the repo root and inside packages/core, creating a d | task | completed | 2026-04-17 |
| Fix code in rex: packages/rex/src/cli/commands/ imports from 40+ internal submodules (core/tree,  | task | completed | 2026-04-14 |
| Fix code in rex-recommend: Add unit tests for recommend/similarity.ts (140 lines, zero tests). At minimum,  | task | completed | 2026-04-14 |
| Fix code in sourcevision-analyzers: The sourcevision-analyzers zone is a degenerate 2-file zone containing only dead (+1 more) | task | completed | 2026-04-14 |
| Fix code in sourcevision-view-tests: Coupling score 0.75 is produced entirely by false-positive string-literal edges, | task | completed | 2026-04-14 |
| Fix code in task-usage-scheduler: start.ts satisfies RegisterSchedulerOptions by passing a concrete options litera (+2 more) | task | completed | 2026-04-14 |
| Fix code in viewer-data-loader: Only one test file (loader-onchange.test.ts) is present for four production file | task | completed | 2026-04-20 |
| Fix code in web-helpers: getLevelEmoji is imported as a runtime function from web-viewer's prd-tree/level | task | completed | 2026-04-14 |
| Fix code in web-server: server/types.ts exports runtime functions jsonResponse(), errorResponse(), and r | task | completed | 2026-04-14 |
| Fix code in web-viewer: boundary-check.test.ts does not assert that viewer→server imports are type-only. (+2 more) | task | completed | 2026-04-14 |
| Fix documentation in sourcevision-view-tests: Zone name 'sourcevision-view-tests' is semantically misleading. These tests cove | task | completed | 2026-04-14 |
| Fix documentation in integration: Codify a co-evolution rule in TESTING.md: each new entry in CLAUDE.md's injectio | task | completed | 2026-04-14 |
| Fix documentation in global: Add a policy note to CLAUDE.md's dual-fragility governance section clarifying wh (+7 more) | task | completed | 2026-04-14 |
| Fix documentation in packages-web:unit-server: packages-web:unit-server meets the dual-fragility criteria (cohesion 0.45, coupl | task | completed | 2026-04-14 |
| Fix documentation in rex: Document the CLI two-tier API pattern in CLAUDE.md with an explicit allowlist of | task | completed | 2026-04-14 |
| Fix documentation in web-helpers: Zone name 'web-helpers' is misleading for a single-component zone — it invites s (+1 more) | task | completed | 2026-04-14 |
| Fix documentation in web-server: packages/web/src/server/ contains two *types.ts files with opposite runtime cont (+1 more) | task | completed | 2026-04-14 |
| Fix move-file in core: File "assistant-assets/index.js" is pinned to zone "Core" but lives in assistant | task | completed | 2026-04-20 |
| Fix move-file in web-server: File "packages/web/src/server/routes-rex/analysis.ts" is pinned to zone "Web Ser | task | completed | 2026-04-14 |
| Fix move-file in web-server: File "packages/web/src/server/routes-rex/analysis.ts" is pinned to zone "Web Ser | task | completed | 2026-04-13 |
| Fix move-file in web-viewer: File "packages/web/src/viewer/hooks/use-polling.ts" is pinned to zone "Web Viewe | task | completed | 2026-04-20 |
| Fix move-file in web-viewer: File "packages/web/src/viewer/components/prd-tree/status-filter.ts" is pinned to | task | completed | 2026-04-14 |
| Fix move-file in web-viewer: File "packages/web/src/viewer/components/progressive-loader.ts" is pinned to zon | task | completed | 2026-04-16 |
| Fix move-file in web-viewer: File "packages/web/src/viewer/external.ts" is pinned to zone "Web Viewer" but li | task | completed | 2026-04-17 |
| Fix observation in domain-gateway-routes-mcp: High coupling (0.6) — 4 imports target "web-server" | task | completed | 2026-04-16 |
| Fix observation in global: Bidirectional coupling: "hench" ↔ "hench-cli-errors" (6+5 crossings) — consider  (+1 more) | task | completed | 2026-04-20 |
| Fix observation in global: Bidirectional coupling: "web-server" ↔ "web-viewer" (31+72 crossings) — consider | task | completed | 2026-04-14 |
| Fix observation in global: Bidirectional coupling: "viewer-ui-hub" ↔ "web-viewer" (5+5 crossings) — conside | task | completed | 2026-04-17 |
| Fix observation in health: High coupling (0.67) — 4 imports target "web" | task | completed | 2026-04-13 |
| Fix observation in hench-2: Generic zone name "Hench 2" — enrichment did not assign a meaningful name reflec | task | completed | 2026-04-17 |
| Fix observation in hench: 9 entry points — wide API surface, consider consolidating exports | task | completed | 2026-04-20 |
| Fix observation in rex-2: Generic zone name "Rex 2" — enrichment did not assign a meaningful name reflecti | task | completed | 2026-04-17 |
| Fix observation in rex-core: High coupling (0.67) — 2 imports target "rex-fix" | task | completed | 2026-04-18 |
| Fix observation in rex-fix: High coupling (0.6) — 1 imports target "rex" | task | completed | 2026-04-18 |
| Fix observation in tick: High coupling (0.56) — 3 imports target "web" | task | completed | 2026-04-13 |
| Fix observation in token: High coupling (0.65) — 8 imports target "web" (+1 more) | task | completed | 2026-04-13 |
| Fix observation in use: High coupling (0.75) — 3 imports target "web" | task | completed | 2026-04-13 |
| Fix observation in viewer-data-loader: High coupling (0.6) — 9 imports target "web-viewer" | task | completed | 2026-04-20 |
| Fix observation in viewer-ui-hub: High coupling (0.63) — 5 imports target "web-viewer" (+1 more) | task | completed | 2026-04-18 |
| Fix observation in web-2: Generic zone name "Web 2" — enrichment did not assign a meaningful name reflecti (+1 more) | task | completed | 2026-04-13 |
| Fix observation in web-3: Generic zone name "Web 3" — enrichment did not assign a meaningful name reflecti (+1 more) | task | completed | 2026-04-18 |
| Fix observation in web-unit: High coupling (0.71) — 3 imports target "web" | task | completed | 2026-04-13 |
| Fix structural in autonomous-agent-engine: No automated intra-zone boundary assertions exist yet; at 208 files the zone is  | task | completed | 2026-04-18 |
| Fix structural in config-validation-gauntlet: The gauntlet/ directory sits outside the established e2e/ and integration/ test  | task | completed | 2026-04-18 |
| Fix structural in e2e-test-infrastructure: Production entry points (assistant-assets/index.js, packages/core/assistant-inte | task | completed | 2026-04-18 |
| Fix structural in global: Both rex fix zones fall at or below the dual-fragility threshold simultaneously; (+3 more) | task | completed | 2026-04-18 |
| Fix structural in global: Three of five zones sit at or below cohesion 0.4; all three (web-3, polling, web | task | completed | 2026-04-20 |
| Fix structural in local-docker-harness: Zone cohesion is 0 across 5 files — below the 5-file metric-reliability threshol | task | completed | 2026-04-18 |
| Fix structural in polling-lifecycle: Duplicate use-polling-suspension.ts exists in both hooks/ and polling/ directori | task | completed | 2026-04-19 |
| Fix structural in project-scaffold: Zone cohesion is 0 — files share no import relationships, confirming this is an  | task | completed | 2026-04-19 |
| Fix structural in rex-fix-command: src/core/fix.ts is separated from the src/fix/ entry point by an artificial dire | task | completed | 2026-04-19 |
| Fix structural in rex-fix-data-model: Zone sits precisely at the dual-fragility boundary (cohesion 0.4, coupling 0.6); | task | completed | 2026-04-19 |
| Fix structural in sourcevision-view-layer: Cohesion 0.33 and coupling 0.67 qualify this as a dual-fragility zone requiring  (+1 more) | task | completed | 2026-04-19 |
| Fix structural in theme-toggle: Single-file micro-zone with cohesion 0 and coupling 1 — an algorithmic artifact. | task | completed | 2026-04-19 |
| Fix structural in viewer-polling-engine: Cohesion (0.4) and coupling (0.6) are both at warning thresholds; the three-file | task | completed | 2026-04-20 |
| Fix structural in viewer-data-loader: Cohesion (0.4) and coupling (0.6) both sit at warning thresholds; the zone mixes | task | completed | 2026-04-20 |
| Fix structural in viewer-data-hooks: Bidirectional imports between this hook zone and the web platform zone (3 edges  | task | completed | 2026-04-19 |
| Fix structural in viewer-ui-hub: Bidirectional 74-edge coupling with Web Dashboard Platform is the largest cross- (+1 more) | task | completed | 2026-04-19 |
| Fix suggestion in hench-2: Zone "hench-2" has a numeric suffix indicating an overflow community — pin its f | task | completed | 2026-04-19 |
| Fix suggestion in hench-4: Zone "hench-4" has a numeric suffix indicating an overflow community — pin its f | task | completed | 2026-04-14 |
| Fix suggestion in rex-2: Zone "rex-2" has a numeric suffix indicating an overflow community — pin its fil | task | completed | 2026-04-14 |
| Fix suggestion in sourcevision-4: Zone "sourcevision-4" has a numeric suffix indicating an overflow community — pi | task | completed | 2026-04-14 |
| Fix suggestion in sourcevision-2: Zone "sourcevision-2" has a numeric suffix indicating an overflow community — pi | task | completed | 2026-04-16 |
| Fix suggestion in sourcevision-3: Zone "sourcevision-3" has a numeric suffix indicating an overflow community — pi | task | completed | 2026-04-16 |
| Fix suggestion in viewer-ui-hub: Zone "Viewer UI Hub" (viewer-ui-hub) has critical risk (score: 0.63, cohesion: 0 | task | completed | 2026-04-19 |
| Fix suggestion in web-3: Zone "web-3" has a numeric suffix indicating an overflow community — pin its fil | task | completed | 2026-04-19 |
| Fix suggestion in web-server: Zone "Web Server Composition Root" (web-server) has catastrophic risk (score: 0. | task | completed | 2026-04-14 |
| Immersive Init Experience with Dinosaur Theme & Branding | feature | completed | 2026-04-08 |
| Scan and fix stale import paths, deprecated Node.js APIs, and outdated module references across packages | task | completed | 2026-04-08 |
| Timer Performance Optimization and Re-render Reduction | feature | completed | 2026-02-27 |
| Token Usage Aggregation Performance Optimization | feature | completed | 2026-02-27 |

## Info

- **Status:** completed
- **Priority:** high
- **Level:** epic
- **Started:** 2026-04-19T03:24:10.418Z
- **Completed:** 2026-04-19T03:24:10.418Z
- **Duration:** < 1m
