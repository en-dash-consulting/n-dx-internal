---
id: "ab7683af-cbeb-4c2f-94a5-6b3da8493f75"
level: "task"
title: "Capture and surface spawn child process stderr in verbose mode"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "error-handling"
  - "dx"
  - "verbose"
source: "smart-add"
startedAt: "2026-06-16T13:21:33.919Z"
completedAt: "2026-06-16T13:52:08.262Z"
endedAt: "2026-06-16T13:52:08.262Z"
acceptanceCriteria:
  - "Spawn child process stderr is captured and printed in verbose mode when the child exits non-zero"
description: "When --verbose is active and a spawned child process exits non-zero, capture its stderr and print it inline after the parent error line. This covers ndx commands that delegate to rex, hench, or sourcevision via child_process.spawn. In non-verbose mode, child stderr should remain suppressed."
---
