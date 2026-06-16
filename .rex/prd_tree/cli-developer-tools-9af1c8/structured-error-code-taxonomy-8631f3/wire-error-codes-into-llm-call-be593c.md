---
id: "be593ca0-0168-4d99-b744-c2d473543789"
level: "task"
title: "Wire error codes into LLM call site error paths and emit bracketed codes in default CLI output"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "error-handling"
  - "dx"
source: "smart-add"
startedAt: "2026-06-16T14:25:10.901Z"
completedAt: "2026-06-16T19:07:08.423Z"
endedAt: "2026-06-16T19:07:08.423Z"
acceptanceCriteria:
  - "Every ndx command's error exit includes a bracketed error code prefix in stdout/stderr (e.g. '[E_TIMEOUT]')"
  - "LLM null-response, timeout, and malformed-response scenarios each produce their distinct code rather than a generic error"
  - "Process exit codes are consistent: non-zero on all classified errors"
description: "Update LLM call sites in hench and llm-client to catch null/empty responses, timeouts, and malformed-response scenarios and map each to the corresponding typed error code from the shared registry. The default error output line should include the code as a bracketed prefix (e.g. '[E_TIMEOUT] LLM request timed out after 30s'). Ensure all error paths exit with a non-zero process exit code."
---
