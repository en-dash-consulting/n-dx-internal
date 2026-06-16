---
id: "cde491e5-b726-4946-a581-ff3ac4e4fb25"
level: "feature"
title: "LLM Response Timeout Floor and Default Standardization"
status: "completed"
source: "smart-add"
startedAt: "2026-06-16T19:38:31.256Z"
completedAt: "2026-06-16T19:38:31.256Z"
endedAt: "2026-06-16T19:38:31.256Z"
acceptanceCriteria: []
description: "All LLM API call timeouts (Claude, Codex, Google Gemini) must default to at least 5 minutes to prevent premature timeouts on large context windows or slow model responses. Some vendor adapters currently inherit sub-5-minute HTTP client defaults. This feature establishes a 5-minute floor as a named constant in llm-client, exposes it as a user-configurable field in .n-dx.json, surfaces it in the settings UI, and adds regression coverage ensuring the default is respected by each adapter."
---

## Children

| Title | Status |
|-------|--------|
| [Raise LLM response timeout defaults to 5-minute minimum across all vendor adapters](./raise-llm-response-timeout-e8edc5.md) | completed |
| [Surface llm.responseTimeout in web settings UI and ndx config help text](./surface-llm-responsetimeout-in-a458c8.md) | completed |
