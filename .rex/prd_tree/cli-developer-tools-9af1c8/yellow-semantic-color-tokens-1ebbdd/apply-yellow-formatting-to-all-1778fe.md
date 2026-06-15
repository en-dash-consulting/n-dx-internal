---
id: "1778feb6-54d1-4c55-a774-bf33ce5d9319"
level: "task"
title: "Apply yellow formatting to all CLI warning messages, remediation hints, and recommended command strings across all packages"
status: "pending"
priority: "medium"
tags:
  - "cli"
  - "color"
  - "ux"
  - "rex"
  - "sourcevision"
  - "hench"
source: "smart-add"
acceptanceCriteria:
  - "All warning-level output lines across rex, sourcevision, hench, and ndx use the `warn()` color helper"
  - "All recommended command strings embedded in CLI output use the `cmd()` color helper and appear yellow"
  - "Remediation flows in auth preflight, self-heal, and error recovery show yellow-highlighted instructions"
  - "Regression tests assert that a representative sample of warning and command lines render yellow in TTY mode"
  - "Plain informational output (non-warning, non-command) is not inadvertently colored yellow"
description: "Audit all CLI output across rex, sourcevision, hench, and ndx to find warning messages, error hints, and 'run X to fix this' command suggestions, then wrap them with the new `warn()` and `cmd()` helpers. Focus areas: ERROR_HINTS entries, self-heal remediation steps, auth and preflight failure guidance, LLM quota warnings, and any line that tells the user to run a specific command. This is a sweeping but mechanical find-and-wrap pass."
overrideMarker: {"type":"duplicate_guard_override","reason":"content_overlap","reasonRef":"content_overlap:418753a7-1d86-446e-a5c7-aeedc63b1ec1","matchedItemId":"418753a7-1d86-446e-a5c7-aeedc63b1ec1","matchedItemTitle":"Apply yellow coloring to help notes and warning messages in hench CLI output","matchedItemLevel":"task","matchedItemStatus":"completed","createdAt":"2026-06-15T14:19:13.298Z"}
---
