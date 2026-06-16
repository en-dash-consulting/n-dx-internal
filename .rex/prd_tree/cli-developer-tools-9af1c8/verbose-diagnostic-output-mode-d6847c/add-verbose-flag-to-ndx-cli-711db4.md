---
id: "711db4ce-77c3-4d18-b4f7-27b7fbb4a75f"
level: "task"
title: "Add --verbose flag to ndx CLI argument surface and forward it to all spawned sub-processes"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "error-handling"
  - "dx"
  - "verbose"
source: "smart-add"
startedAt: "2026-06-16T13:12:41.910Z"
completedAt: "2026-06-16T13:20:52.224Z"
endedAt: "2026-06-16T13:20:52.224Z"
acceptanceCriteria:
  - "ndx <any-command> --verbose is accepted without error on all commands"
  - "--verbose is forwarded to spawned rex, hench, and sourcevision sub-processes so they also emit verbose output"
  - "NO_COLOR and TTY detection still apply to verbose output"
description: "Add a --verbose (or -v) flag to the ndx CLI argument surface. When present, forward the flag to every spawned rex, hench, and sourcevision child process so they also emit verbose output. Ensure NO_COLOR and TTY detection still apply to verbose output. Normal success output must remain unchanged — the flag only expands error paths."
---
