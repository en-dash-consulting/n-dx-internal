# Documentation

Internal documentation for n-dx development. For user-facing documentation, see the [root README](../README.md) and individual package READMEs.

## Architecture

Design decisions, reference documents, and zone governance.

| Document | Description |
|----------|-------------|
| [level-system-reference.md](architecture/level-system-reference.md) | Catalog of hardcoded level hierarchy references across the codebase |
| [memory-architecture.md](architecture/memory-architecture.md) | Three-tier memory management system (hench, web server, browser) |
| [prd-steward-vision.md](architecture/prd-steward-vision.md) | Vision for evolving Rex into an intelligent PRD curator |
| [viewer-architecture.md](architecture/viewer-architecture.md) | Unified web dashboard architecture (Data APIs + Viewer Descriptors) |
| [web-zone-architecture.md](architecture/web-zone-architecture.md) | Web package zone topology and governance |
| [zone-naming-conventions.md](architecture/zone-naming-conventions.md) | Zone ID naming standards (kebab-case, test suffixes) |

## Analysis

Audits and deep-dive investigations of specific subsystems.

| Document | Description |
|----------|-------------|
| [refresh-orchestration-memory-analysis.md](analysis/2026-03-03-refresh-orchestration-memory-analysis.md) | Memory consumption audit of `ndx refresh` operations |
| [memory-risks-and-flaws.md](analysis/memory-risks-and-flaws.md) | Prioritized catalog of memory management risks |
| [process-lifecycle-audit.md](analysis/process-lifecycle-audit.md) | Process spawn/teardown inventory and signal handling |
| [resource-allocation-catalog.md](analysis/resource-allocation-catalog.md) | TCP ports, file handles, timers, and child process catalog |
| [signal-handling-audit.md](analysis/signal-handling-audit.md) | Signal handler inventory across all packages |
| [viewer-audit.md](analysis/viewer-audit.md) | Viewer code distribution audit and migration proposal |

## Process

Implementation plans and feature specifications.

| Document | Description |
|----------|-------------|
| [level-refactor-and-steward-plan.md](process/level-refactor-and-steward-plan.md) | Multi-phase plan for level system refactoring and PRD steward features |
| [memory-improvements.md](process/memory-improvements.md) | Prioritized memory management improvements with effort estimates |
| [memory-os-behavior.md](process/memory-os-behavior.md) | Platform-specific memory reporting behavior (macOS, Linux, Windows, containers) |
| [rex-smart-add-duplicate-detection.md](process/rex-smart-add-duplicate-detection.md) | Smart add duplicate detection design and implementation spec |

## Root-Level Documents

| Document | Description |
|----------|-------------|
| [CLAUDE.md](../CLAUDE.md) | AI assistant instructions (architecture, conventions, governance rules) |
| [CODEX.md](../CODEX.md) | Codex-specific mirror of CLAUDE.md with troubleshooting section |
| [TESTING.md](../TESTING.md) | Test tier requirements, integration test policy, required tests |
| [PACKAGE_GUIDELINES.md](../PACKAGE_GUIDELINES.md) | Package conventions, gateway patterns, dependency hierarchy |
| [ENFORCEMENT.md](../ENFORCEMENT.md) | Architectural enforcement map (which rules are enforced where) |
| [prd.md](../prd.md) | n-dx v1 product vision and epic roadmap |
