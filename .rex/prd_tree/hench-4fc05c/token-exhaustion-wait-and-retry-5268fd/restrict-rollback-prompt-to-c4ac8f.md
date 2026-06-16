---
id: "c4ac8fba-58e2-4f61-9465-d87953fabcba"
level: "task"
title: "Restrict rollback prompt to Ctrl+C interrupts with Y/n confirmation and immediate cancel on any other input"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "cli"
  - "ux"
  - "signal-handling"
source: "smart-add"
startedAt: "2026-06-16T21:23:14.925Z"
completedAt: "2026-06-16T21:49:34.063Z"
endedAt: "2026-06-16T21:49:34.063Z"
acceptanceCriteria:
  - "First Ctrl+C during a hench run shows the rollback Y/n prompt and does not auto-cancel"
  - "Entering 'Y' or 'y' triggers the existing rollback path and exits"
  - "Any other input (including empty enter, 'n', or any other key) cancels the loop/run/command without rollback"
  - "Second Ctrl+C during the prompt still force-exits (existing behavior preserved)"
  - "Integration test covers all three branches: Y → rollback, n → cancel without rollback, second Ctrl+C → force exit"
description: "Rework the SIGINT handler in the hench run loop so the rollback prompt is the ONLY thing shown on first Ctrl+C, and the prompt is a strict Y/n confirmation: 'Y' (or 'y') proceeds with the existing rollback flow and quits, while any other input — including empty enter, 'n', or any other key — immediately cancels the loop/run/command without performing a rollback. Coordinate with the existing SIGINT-handler suspension so a second Ctrl+C during the prompt force-exits as it does today."
overrideMarker: {"type":"duplicate_guard_override","reason":"content_overlap","reasonRef":"content_overlap:20bbb688-65c2-4331-a508-5b5700272200","matchedItemId":"20bbb688-65c2-4331-a508-5b5700272200","matchedItemTitle":"Add integration tests for Ctrl-C interrupt and rollback prompt interaction","matchedItemLevel":"task","matchedItemStatus":"completed","createdAt":"2026-06-16T19:40:54.818Z"}
---
