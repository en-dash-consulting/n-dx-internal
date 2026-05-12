---
id: "03266251-06ef-4864-960a-0cb02986ff1d"
level: "feature"
title: "Task Repetition Detection and Completion Enforcement in Hench Run Loop"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "Hench currently re-selects and re-works tasks that should already be complete, wasting iterations and tokens. This feature adds explicit guardrails: (1) detect when the same task has been worked on three times in a single run and force selection of a new task on the next iteration, (2) immediately mark a task as completed and advance to a new task when the run loop determines it has succeeded, and (3) exclude already-completed tasks from selection entirely. Adds regression coverage and assistant skills so the behavior is enforced going forward."
---

## Children

| Title | Status |
|-------|--------|
| [Add Claude Code skill enforcing task-repetition and completion-advancement invariants](./add-claude-code-skill-enforcing-0b75c9.md) | pending |
| [Exclude completed tasks from hench task selection across all selection paths](./exclude-completed-tasks-from-f2b6fb.md) | in_progress |
| [Mark task completed and advance immediately on successful run completion](./mark-task-completed-and-advance-24913e.md) | pending |
| [Track per-task attempt counts in hench run loop and force advancement after three repeats](./track-per-task-attempt-counts-af8e53.md) | pending |
