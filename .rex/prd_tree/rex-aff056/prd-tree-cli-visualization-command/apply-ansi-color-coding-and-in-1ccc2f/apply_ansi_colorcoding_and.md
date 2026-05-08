---
id: "1ccc2ffe-076b-4209-8ebb-ccf1ac871a44"
level: "task"
title: "Apply ANSI color-coding and in-progress markers to `ndx tree` output"
status: "pending"
priority: "high"
tags:
  - "cli"
  - "ansi"
  - "prd"
source: "smart-add"
acceptanceCriteria:
  - "Completed items are rendered with purple ANSI color applied to the full title line"
  - "In-progress items are rendered in yellow with `**` prepended and appended to the title"
  - "Pending items are rendered without any ANSI codes"
  - "When `NO_COLOR` is set or stdout is not a TTY, all ANSI sequences are stripped and `**` markers are still present for in-progress items"
  - "Color constants are sourced from the shared ANSI color utility — no inline color codes"
description: "Extend the tree command output with the specified color scheme: completed items in purple, in-progress items in yellow with `**title**` surrounding asterisks, and pending items with no color. Must reuse the shared ANSI color utility already used across other CLI commands and must respect `NO_COLOR` and non-TTY detection."
---
