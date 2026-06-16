---
id: "7357d7d7-aecc-4ee2-990f-a81c7cd77eac"
level: "feature"
title: "Disable Code Rollback on Run Failure with Cancel-and-Notify Semantics"
status: "completed"
source: "smart-add"
startedAt: "2026-06-16T20:38:13.340Z"
completedAt: "2026-06-16T20:38:13.340Z"
endedAt: "2026-06-16T20:38:13.340Z"
acceptanceCriteria: []
description: "Remove all automatic code rollback behavior from hench run failure paths. On non-retriable errors, the run loop must cancel cleanly, stop further iterations, and surface a notification summarizing how many files were changed — without reverting, resetting, or otherwise mutating the working tree. The rollback confirmation prompt and any git-restore logic should be retired in favor of a no-op cancel that preserves all uncommitted work."
---

## Children

| Title | Status |
|-------|--------|
| [Remove automatic git rollback logic from hench run failure and cancellation paths](./remove-automatic-git-rollback-134264.md) | completed |
| [Stop run loop on non-retriable errors and emit changed-file count notification](./stop-run-loop-on-non-retriable-6c7b2d.md) | completed |
