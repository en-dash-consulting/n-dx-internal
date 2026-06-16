---
id: "1ae99d42-2a44-466f-8054-c03ca6a07bed"
level: "task"
title: "Suppress rollback prompt on insufficient-token errors and emit single token-replenishment wait message"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "llm"
  - "ux"
source: "smart-add"
startedAt: "2026-06-16T21:50:17.694Z"
acceptanceCriteria:
  - "Insufficient-token, quota-exhausted, and rate-limit errors are routed through the token-wait path and do not trigger the rollback prompt"
  - "A single status message announcing the wait-and-retry is printed once per token-wait event, not repeated on each retry tick"
  - "Token-wait classification reuses the existing shared LLM error classifier with no duplicated detection logic"
  - "Regression test asserts no rollback prompt is rendered when the run fails with a classified token-exhaustion error"
description: "Classify run failures in the hench run loop so insufficient-token / rate-limit / quota-exhausted errors take a dedicated path that does not invoke the rollback confirmation prompt. Instead, emit a single user-visible status line indicating the run is waiting for token replenishment, then enter the existing retry/backoff path. Reuse the shared LLM error classifier already used for quota detection so the path is consistent across Claude, Codex, and Google vendors."
---
