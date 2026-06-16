---
id: "6c7b2d62-2bb0-4d12-8510-231f9459f0a8"
level: "task"
title: "Stop run loop on non-retriable errors and emit changed-file count notification"
status: "completed"
priority: "critical"
tags:
  - "hench"
  - "run-loop"
  - "error-handling"
source: "smart-add"
startedAt: "2026-06-16T20:31:05.897Z"
completedAt: "2026-06-16T20:38:11.777Z"
endedAt: "2026-06-16T20:38:11.777Z"
acceptanceCriteria:
  - "Non-retriable error classification is centralized and reused across loop modes"
  - "On non-retriable error, the loop does not pick up a next task and the process exits with a clear status code"
  - "Terminal notification reports the number of files changed in the failed/cancelled run and the originating error code"
  - "Retriable errors (E_RATE_LIMITED, token-exhaustion) still trigger wait-and-retry and do not invoke the stop-and-notify path"
  - "Integration tests cover both the stop-on-non-retriable path and the continued-retry path for retriable errors"
description: "When a non-retriable error occurs mid-loop (--loop, --auto, --epic-by-epic), the loop must terminate immediately after the in-flight task settles, without rolling back code or advancing to the next task. Emit a single terminal notification that includes the count of files changed during the cancelled/failed run and the error code that triggered termination. Retriable errors (token exhaustion, transient rate limits) should retain their existing wait-and-retry behavior — only non-retriable errors trigger the hard stop."
---
