---
id: "54b28dd7-df82-47e3-948f-2d76bfaeab90"
level: "task"
title: "Add interactive task-approval prompt to ndx self-heal before execution begins"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "self-heal"
  - "ux"
source: "smart-add"
startedAt: "2026-05-11T15:29:15.044Z"
completedAt: "2026-05-11T15:42:55.974Z"
endedAt: "2026-05-11T15:42:55.974Z"
acceptanceCriteria:
  - "Running `ndx self-heal` in a TTY without --auto/--yes prints the queued task list and waits for y/N confirmation before any hench run starts"
  - "Declining the prompt exits with a non-zero status and performs no PRD writes or hench invocations"
  - "Accepting the prompt proceeds through the existing self-heal loop with no behavior change beyond the added gate"
  - "Non-TTY invocations without an auto-confirm flag or config setting fail fast with a clear error explaining how to opt into unattended runs"
description: "Insert a pre-execution gate in the ndx self-heal command that, after the analyze/recommend phase resolves the candidate task list, prints the tasks to be worked and prompts the user to confirm before invoking hench. The prompt should clearly summarize task count, titles, and any --loop iteration plan so the user understands the blast radius before approving. Declining must exit cleanly with a non-zero code and leave the PRD unmodified."
---
