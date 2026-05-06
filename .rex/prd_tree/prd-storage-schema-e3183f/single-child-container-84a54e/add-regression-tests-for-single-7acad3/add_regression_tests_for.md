---
id: "7acad3da-6e29-4e52-bed1-121ad63b4fd3"
level: "task"
title: "Add regression tests for single-child compaction across write path and reshape migration"
status: "pending"
priority: "medium"
tags:
  - "rex"
  - "testing"
  - "folder-tree"
  - "reshape"
source: "smart-add"
acceptanceCriteria:
  - "Serializer unit test: single-child container produces a flat file, not a subdirectory + index.md"
  - "Serializer unit test: two-child container still produces the existing subdirectory structure"
  - "Reshape integration test: fixture tree with 3 over-wrapped directories is fully compacted in one reshape run"
  - "Reshape integration test: re-running reshape on the compacted fixture produces no further changes"
  - "Parser unit test: compacted tree round-trips back to the original PRD item tree with all titles, statuses, and metadata intact"
description: "Write regression tests covering both surfaces introduced by single-child compaction: (1) serializer unit tests asserting the new write-path behavior for single-child vs multi-child containers, and (2) integration tests for the reshape compaction pass using a fixture prd_tree containing known over-wrapped directories. Tests should verify idempotency, metadata preservation, and that no data is lost when a wrapper directory is collapsed."
---
