---
id: "1342643e-4d2a-49c7-ade9-615b13adf7c7"
level: "task"
title: "Remove automatic git rollback logic from hench run failure and cancellation paths"
status: "completed"
priority: "critical"
tags:
  - "hench"
  - "run-loop"
  - "safety"
source: "smart-add"
startedAt: "2026-06-16T20:18:53.387Z"
completedAt: "2026-06-16T20:30:39.730Z"
endedAt: "2026-06-16T20:30:39.730Z"
acceptanceCriteria:
  - "No hench code path invokes git restore, git reset, git checkout --, or equivalent destructive git operations on run failure or cancellation"
  - "Working tree state after a failed or cancelled run is byte-identical to the state immediately before the cancel/error signal"
  - "Existing rollback config flags and prompts are removed or made no-ops with clear deprecation messaging"
  - "Regression tests assert working-tree preservation across forced failure, SIGINT cancel, and commit-timeout scenarios"
description: "Audit hench run lifecycle code paths that currently invoke git restore/reset on failed runs, SIGINT cancellation, or commit-timeout flows. Strip out the rollback execution while preserving the cancel signal so the loop exits cleanly. All previously rolled-back code must remain in the working tree intact."
---
