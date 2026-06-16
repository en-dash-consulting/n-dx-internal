---
id: "d6847c10-bfbc-404f-8591-b6ea7b3dde20"
level: "feature"
title: "Verbose Diagnostic Output Mode Across All Commands"
status: "completed"
source: "smart-add"
startedAt: "2026-06-16T19:28:48.112Z"
completedAt: "2026-06-16T19:28:48.112Z"
endedAt: "2026-06-16T19:28:48.112Z"
acceptanceCriteria: []
description: "Add a --verbose flag to the ndx CLI surface (and propagate it to rex, hench, and sourcevision sub-commands) that, when passed, outputs full diagnostic context on errors: raw LLM response bodies, stack traces, spawn stderr, request/response metadata, and any intermediate state that would help a developer diagnose the failure. Without the flag, output stays concise with just the error code and message."
---

## Children

| Title | Status |
|-------|--------|
| [Add --verbose flag to ndx CLI argument surface and forward it to all spawned sub-processes](./add-verbose-flag-to-ndx-cli-711db4.md) | completed |
| [Capture and surface spawn child process stderr in verbose mode](./capture-and-surface-spawn-child-ab7683.md) | completed |
| [Extend tests to verify --verbose produces additional diagnostic output and passes CI on macOS and Linux](./extend-tests-to-verify-verbose-5ed4a9.md) | completed |
| [Implement verbose LLM error output including raw response body excerpt and stack trace](./implement-verbose-llm-error-abeb1d.md) | completed |
| [Write regression tests for default error code emission across all major error categories](./write-regression-tests-for-d5fa88.md) | completed |
