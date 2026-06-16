---
id: "8631f3b1-b381-493d-a3c0-4b673d842be3"
level: "feature"
title: "Structured Error Code Taxonomy and Cross-Package Classification"
status: "completed"
source: "smart-add"
startedAt: "2026-06-16T14:51:11.687Z"
completedAt: "2026-06-16T14:51:11.687Z"
endedAt: "2026-06-16T14:51:11.687Z"
acceptanceCriteria: []
description: "Establish a shared, typed error code registry covering all failure categories that CLI commands can encounter — null/empty LLM responses, operation timeouts, malformed or unparseable responses, authentication failures, network errors, and unexpected internal errors. Each code should be human-readable and map to a distinct failure mode so users and scripts can act on the code without reading prose."
---

## Children

| Title | Status |
|-------|--------|
| [Create shared error code registry module with typed constants and severity metadata](./create-shared-error-code-ceb8dc.md) | completed |
| [Validate error registry importability across hench, rex, and llm-client with unit tests](./validate-error-registry-f04eb9.md) | completed |
| [Wire error codes into LLM call site error paths and emit bracketed codes in default CLI output](./wire-error-codes-into-llm-call-be593c.md) | completed |
