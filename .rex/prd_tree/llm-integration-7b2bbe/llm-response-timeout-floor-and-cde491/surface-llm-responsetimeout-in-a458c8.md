---
id: "a458c805-59b6-4c68-8346-b0cc90e743d1"
level: "task"
title: "Surface llm.responseTimeout in web settings UI and ndx config help text"
status: "completed"
priority: "medium"
tags:
  - "timeouts"
  - "llm"
  - "settings-ui"
  - "config"
source: "smart-add"
startedAt: "2026-06-16T19:29:24.883Z"
completedAt: "2026-06-16T19:38:29.563Z"
endedAt: "2026-06-16T19:38:29.563Z"
acceptanceCriteria:
  - "The web settings UI LLM panel includes a numeric input for 'LLM Response Timeout (seconds)' that reads from and writes to llm.responseTimeout"
  - "ndx config llm.responseTimeout <value> sets the field; ndx config llm.responseTimeout with no value prints the current setting"
  - "ndx config --help lists llm.responseTimeout with its description and 300-second default"
  - "The UI input rejects non-positive or non-numeric values with an inline validation message"
description: "Add the llm.responseTimeout config field to the web settings UI LLM configuration panel and document it in ndx config --help output. This makes the timeout visible and editable from both the CLI and the dashboard without requiring manual .n-dx.json edits, consistent with how other LLM config fields (model, vendor, budget) are surfaced."
---
