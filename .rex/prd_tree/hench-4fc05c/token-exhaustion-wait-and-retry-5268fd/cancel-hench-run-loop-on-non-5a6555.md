---
id: "5a655501-6d75-4c7b-8475-d950ad154f45"
level: "task"
title: "Cancel hench run loop on non-token errors with notification and no rollback prompt"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "cli"
  - "error-handling"
source: "smart-add"
startedAt: "2026-06-16T19:41:25.256Z"
completedAt: "2026-06-16T20:18:19.225Z"
endedAt: "2026-06-16T20:18:19.225Z"
acceptanceCriteria:
  - "Non-token-exhaustion run failures terminate the loop without invoking the rollback prompt"
  - "Error notification includes the structured error code and a one-line cause summary"
  - "Exit code reflects failure (non-zero) for non-token error terminations"
  - "Regression test covers at least one non-token error category (e.g., E_MALFORMED_RESPONSE) and asserts no rollback prompt and a non-zero exit"
description: "For run failures that are not classified as token-exhaustion (e.g., malformed response, tool errors, unrecoverable LLM errors, network failures outside rate-limit semantics), notify the user with a clear error message including the error code, then terminate the loop/run/command without offering the rollback confirmation. This preserves the existing rollback behavior only for Ctrl+C interrupts."
---
