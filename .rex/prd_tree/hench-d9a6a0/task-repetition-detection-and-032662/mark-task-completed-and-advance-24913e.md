---
id: "24913e03-3f2d-458b-890b-9d71ca70d128"
level: "task"
title: "Mark task completed and advance immediately on successful run completion"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "run-loop"
  - "prd-status"
source: "smart-add"
acceptanceCriteria:
  - "Successful task completion transitions PRD status to completed before the next iteration's task selection"
  - "Next iteration never re-selects a task whose status was just set to completed"
  - "Status transition is reflected in the folder-tree PRD storage and propagated to the dashboard"
  - "Regression test asserts that a synthetic successful run advances to a new task on the following iteration"
description: "Audit the hench run loop's post-iteration handling to ensure that when a task is determined to have succeeded (tests pass, acceptance criteria met, commit landed), the task's status is transitioned to completed in the PRD before the next iteration begins. The next iteration must then select a new task rather than re-picking the just-completed one. Covers the gap where completion signals exist but advancement is not enforced."
---
