---
"@n-dx/rex": patch
---

`n-dx add` no longer creates a duplicate epic when the work belongs under an
existing one. Smart-add relied on the LLM setting `existingId` to nest under an
existing epic/feature; when it didn't, a new epic with the same title was
created. Added a deterministic post-generation placement pass that matches
proposed epics/features against existing PRD containers (high-confidence,
title-based) and fills `existingId` so the new task nests instead of
duplicating. Respects an `existingId` the LLM already set; skipped when an
explicit `--parent` is given.
