---
id: "5ed4a948-df2d-4475-9126-9d440c945a77"
level: "task"
title: "Extend tests to verify --verbose produces additional diagnostic output and passes CI on macOS and Linux"
status: "pending"
priority: "medium"
tags:
  - "cli"
  - "error-handling"
  - "testing"
  - "dx"
source: "smart-add"
acceptanceCriteria:
  - "For each scenario, running with --verbose produces output containing additional lines not present in the default run"
  - "All tests pass in CI on both macOS and Linux runners"
description: "For each mocked error scenario (E_TIMEOUT, E_MALFORMED_RESPONSE, E_NULL_RESPONSE), add a paired --verbose assertion that confirms additional output lines are present that are absent in the default run. Ensure all tests in this suite are tagged to run in CI on both macOS and Linux runners."
---
