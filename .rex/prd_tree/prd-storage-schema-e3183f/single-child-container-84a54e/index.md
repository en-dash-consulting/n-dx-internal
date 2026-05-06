---
id: "84a54eee-5e54-43c0-8232-fa8929e64e33"
level: "feature"
title: "Single-Child Container Elimination in PRD Folder Tree"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "Eliminate unnecessary wrapper directories in the PRD folder tree when a parent container holds exactly one child item plus an index.md. The current serializer always creates a directory + index.md for every feature/epic, even when a single child task makes the container redundant. This adds noise to the file tree and complicates tooling. The fix spans two surfaces: the write path (prevent over-creation going forward) and a reshape migration pass (flatten existing over-wrapped directories in repos already on disk)."
---

# Single-Child Container Elimination in PRD Folder Tree

 [pending]

## Summary

Eliminate unnecessary wrapper directories in the PRD folder tree when a parent container holds exactly one child item plus an index.md. The current serializer always creates a directory + index.md for every feature/epic, even when a single child task makes the container redundant. This adds noise to the file tree and complicates tooling. The fix spans two surfaces: the write path (prevent over-creation going forward) and a reshape migration pass (flatten existing over-wrapped directories in repos already on disk).

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add regression tests for single-child compaction across write path and reshape migration | task | pending | 1970-01-01 |
| Add single-child detection to PRD folder-tree serializer to skip container directory when parent has exactly one child | task | in_progress | 2026-05-06 |
| Implement single-child compaction migration pass in `ndx reshape` to flatten existing over-wrapped directories | task | pending | 1970-01-01 |

## Info

- **Status:** pending
- **Level:** feature
