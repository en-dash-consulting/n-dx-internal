---
id: "ceb8dc48-ffec-4dfa-82e5-e458f8185909"
level: "task"
title: "Create shared error code registry module with typed constants and severity metadata"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "error-handling"
  - "dx"
source: "smart-add"
startedAt: "2026-06-16T14:17:22.416Z"
completedAt: "2026-06-16T14:19:28.095Z"
endedAt: "2026-06-16T14:19:28.095Z"
acceptanceCriteria:
  - "A shared error code module exports typed constants for at least: null/empty response, timeout, malformed/parse failure, auth failure, network error, rate limit, and budget exceeded"
  - "Each constant has a machine-readable key (e.g. 'E_TIMEOUT'), a short label, and a severity field"
description: "Create a cross-package error code registry (e.g. in llm-client or a new shared errors module) that enumerates typed constants for each distinct failure category: E_NULL_RESPONSE, E_TIMEOUT, E_MALFORMED_RESPONSE, E_AUTH_FAILURE, E_NETWORK_ERROR, E_PARSE_ERROR, E_RATE_LIMIT, E_BUDGET_EXCEEDED, and E_UNKNOWN. Each constant carries a short machine-readable key, a human-readable label, and a severity level. This file is the single source of truth — no logic, only the registry shape."
---
