---
id: "f04eb91e-9016-4666-9028-e5b589149543"
level: "task"
title: "Validate error registry importability across hench, rex, and llm-client with unit tests"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "error-handling"
  - "dx"
source: "smart-add"
startedAt: "2026-06-16T14:19:52.025Z"
completedAt: "2026-06-16T14:24:42.622Z"
endedAt: "2026-06-16T14:24:42.622Z"
acceptanceCriteria:
  - "The module is importable from hench, rex, and llm-client without circular dependencies"
  - "Unit tests assert each constant's shape and uniqueness of keys"
description: "Verify that the new error code module can be imported from hench, rex, and llm-client without introducing circular dependencies. Add unit tests that assert the shape of each constant (key uniqueness, required fields) and confirm no import cycles are introduced. Run the existing architecture-policy and domain-isolation tests to confirm the module fits within the established tier hierarchy."
---
