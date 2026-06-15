---
id: "e6fce50f-0100-4c06-aaa1-144a1c1e0f57"
level: "task"
title: "Add yellow warn and cmd semantic tokens to the shared ANSI color utility"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "color"
  - "ux"
source: "smart-add"
startedAt: "2026-06-15T14:19:49.079Z"
acceptanceCriteria:
  - "Shared color utility exports `warn(text: string): string` and `cmd(text: string): string` helpers"
  - "Both render yellow (ANSI 33 or bright yellow) in a TTY environment"
  - "Both render plain text when NO_COLOR is set or stdout is not a TTY"
  - "Unit tests verify yellow rendering in TTY mode and plain-text fallback in non-TTY / NO_COLOR mode"
  - "Existing color utility exports are unchanged — no breaking changes to current callers"
description: "Extend the shared ANSI color formatting utility with two named semantic helpers: `warn(text)` for warning-level messages and `cmd(text)` for command strings the user should run. Both render yellow (ANSI 33) and must respect existing TTY detection and NO_COLOR suppression. Document the semantic distinction between these and the existing log-level color tokens so future callers use the right helper."
overrideMarker: {"type":"duplicate_guard_override","reason":"content_overlap","reasonRef":"content_overlap:2faf9d58-2878-4e12-a9e3-b613591fd7bd","matchedItemId":"2faf9d58-2878-4e12-a9e3-b613591fd7bd","matchedItemTitle":"Build shared ANSI color formatting utility with TTY and NO_COLOR support","matchedItemLevel":"task","matchedItemStatus":"completed","createdAt":"2026-06-15T14:19:13.298Z"}
---
