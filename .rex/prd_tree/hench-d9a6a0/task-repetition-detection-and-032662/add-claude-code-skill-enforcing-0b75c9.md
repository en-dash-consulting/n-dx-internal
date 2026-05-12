---
id: "0b75c98d-cbee-49d2-9cda-0fa3946e057f"
level: "task"
title: "Add Claude Code skill enforcing task-repetition and completion-advancement invariants"
status: "pending"
priority: "medium"
tags:
  - "skills"
  - "documentation"
  - "hench"
source: "smart-add"
acceptanceCriteria:
  - "New skill is registered and appears in the available-skills list"
  - "Skill documents the three invariants with concrete examples of correct vs incorrect behavior"
  - "Skill references the run-loop code paths that enforce each invariant"
  - "Hench contributor docs link to the skill from the run-loop section"
description: "Author a new assistant skill (sibling to existing ndx-* skills) that documents and enforces the run-loop invariants introduced by this feature: never re-pick a completed task, advance after three repeats, transition status before next selection. The skill should be discoverable via the standard skill list and referenced from the hench run loop's contributor docs so future changes preserve the invariants."
---
