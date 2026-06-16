---
id: "490146ad-e0ac-4dd8-b691-195c0c89c3a9"
level: "task"
title: "Audit all timeout constants across packages and classify config-surface coverage"
status: "completed"
priority: "high"
tags:
  - "timeouts"
  - "audit"
  - "config"
source: "smart-add"
startedAt: "2026-06-16T14:10:46.157Z"
completedAt: "2026-06-16T14:16:38.125Z"
endedAt: "2026-06-16T14:16:38.125Z"
acceptanceCriteria:
  - "All timeout literals in production source files are catalogued with package, file, line, and current value"
  - "Each timeout is classified as 'already configurable', 'needs config wiring', or 'intentionally hardcoded with documented rationale'"
  - "The classification is committed as inline comments or a tracking note visible to reviewers"
description: "Grep all production source files across core, rex, hench, sourcevision, and web packages for hardcoded timeout values (setTimeout, setInterval, AbortSignal.timeout, axios/fetch timeout options, execa/spawn timeout flags, etc.) and produce a classified inventory: which are already wired to .n-dx.json / ndx config, which need config wiring, and which are intentionally hardcoded. This inventory drives the remediation task scope."
---
