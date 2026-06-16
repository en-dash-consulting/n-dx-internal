---
id: "abeb1d27-778a-47b4-b020-d77b562d93f4"
level: "task"
title: "Implement verbose LLM error output including raw response body excerpt and stack trace"
status: "pending"
priority: "high"
tags:
  - "cli"
  - "error-handling"
  - "dx"
  - "verbose"
source: "smart-add"
acceptanceCriteria:
  - "On a classified error (e.g. E_MALFORMED_RESPONSE), --verbose appends the raw response body or a truncated excerpt (max 2000 chars) after the error line"
  - "Stack traces appear in verbose mode and are suppressed in non-verbose mode"
description: "When --verbose is active and an LLM error is classified (e.g. E_MALFORMED_RESPONSE, E_NULL_RESPONSE, E_TIMEOUT), append to the error output: the raw LLM response body or a truncated excerpt (max 2000 chars), the full stack trace, and HTTP status and headers for API calls. When --verbose is absent, suppress stack traces and raw bodies — only the bracketed code and message line should appear."
---
