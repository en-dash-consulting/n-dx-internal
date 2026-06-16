---
id: "d5fa88af-6823-47da-b3f4-6c4ce0fce62d"
level: "task"
title: "Write regression tests for default error code emission across all major error categories"
status: "pending"
priority: "medium"
tags:
  - "cli"
  - "error-handling"
  - "testing"
  - "dx"
source: "smart-add"
acceptanceCriteria:
  - "Test for E_TIMEOUT: mocked timeout scenario produces '[E_TIMEOUT]' in output"
  - "Test for E_MALFORMED_RESPONSE: mocked bad LLM JSON produces '[E_MALFORMED_RESPONSE]' in output"
  - "Test for E_NULL_RESPONSE: empty LLM body produces '[E_NULL_RESPONSE]' in output"
  - "Tests run without network access (all LLM calls mocked)"
description: "Write integration tests that mock each major LLM error category (timeout, null/empty response, malformed response) and assert that the correct bracketed error code prefix appears in default (non-verbose) output. All LLM calls must be mocked so tests run without network access."
---
