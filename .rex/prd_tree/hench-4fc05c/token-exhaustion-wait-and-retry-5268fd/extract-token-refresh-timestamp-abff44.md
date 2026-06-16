---
id: "abff441e-d4d5-4bb1-9b8c-7b2589aaecb6"
level: "task"
title: "Extract token-refresh timestamp from insufficient-token API error responses"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "llm-client"
  - "token-exhaustion"
source: "smart-add"
acceptanceCriteria:
  - "Returns a `Date` for Claude, Codex, and Google rate-limit / quota-exhausted error responses that include a reset time"
  - "Returns `null` when no reset time is present in the error payload"
  - "Unit tests cover each provider's error format, including missing/malformed reset fields"
  - "Extraction is a pure function with no side effects, callable from the run loop without triggering additional API calls"
description: "When the LLM provider returns an insufficient-tokens or rate-limit error, parse the reset/retry-after timestamp from the error payload (HTTP header, JSON body, or error message). Expose it as a structured value — `refreshAt: Date | null` — so the wait logic can consume it without re-parsing. Cover Claude, Codex, and Google provider error shapes."
---
