---
id: "c1a5525b-c8c3-4653-8815-1e22fd02797e"
level: "feature"
title: "Universal Timeout Editability Audit and Remediation"
status: "completed"
source: "smart-add"
startedAt: "2026-06-16T14:16:39.002Z"
completedAt: "2026-06-16T14:16:39.002Z"
endedAt: "2026-06-16T14:16:39.002Z"
acceptanceCriteria: []
description: "Audit every hardcoded or implicitly-set timeout across all n-dx packages (core, rex, hench, sourcevision, web) and ensure each one is exposed as an editable configuration value. The completed 'Configurable CLI Operation Timeouts' feature covered the primary CLI command surface; this work fills remaining gaps — internal LLM call timeouts, MCP request timeouts, file-watcher debounces, process spawn timeouts, and any other non-configurable waits that could cause silent failures on slow machines or large contexts."
---

## Children

| Title | Status |
|-------|--------|
| [Audit all timeout constants across packages and classify config-surface coverage](./audit-all-timeout-constants-490146.md) | completed |
