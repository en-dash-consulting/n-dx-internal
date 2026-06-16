---
id: "6339469e-655f-437e-a806-53b9799d14dc"
level: "task"
title: "Implement idle wait-until-refresh and single-retry loop exit for token exhaustion"
status: "in_progress"
priority: "high"
tags:
  - "hench"
  - "token-exhaustion"
  - "run-loop"
source: "smart-add"
startedAt: "2026-06-16T21:06:45.429Z"
acceptanceCriteria:
  - "No LLM API calls are issued between the token-exhaustion error and the single retry"
  - "Wait duration is computed as `refreshAt + 1000 ms - Date.now()`; a countdown message is shown to the user during the wait"
  - "Exactly one retry is attempted after the wait; the loop exits regardless of retry outcome"
  - "User receives a clear notification stating whether the retry succeeded or failed before the loop exits"
  - "Loop exits cleanly — no rollback prompt, no consecutive-failure counter increment for the wait period"
  - "When `refreshAt` is null the path delegates to the existing non-token-error cancellation logic (no change to that path)"
  - "Integration test simulates a token-exhaustion error with a known refresh time and asserts the single-retry-then-exit behaviour"
description: "When the run loop encounters an insufficient-token error and a refresh timestamp is available, suspend all LLM activity (no polling, no retries, no background calls) until `refreshAt + 1 second`, then issue exactly one retry. Whether the retry succeeds or fails, emit a user-facing notification summarising the outcome and terminate the run loop — do not continue iterating or prompt for rollback. If no refresh timestamp is available, fall through to the existing non-token cancellation path."
---
