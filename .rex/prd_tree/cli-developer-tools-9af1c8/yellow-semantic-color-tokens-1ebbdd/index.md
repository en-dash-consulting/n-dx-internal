---
id: "1ebbddab-79af-46f8-a32f-15a025882bff"
level: "feature"
title: "Yellow Semantic Color Tokens for Warnings, Commands, and Remediation Flows"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "Establish yellow as the canonical ANSI color for all user-action-required output: warning messages, recommended commands, and step-by-step remediation flows across all CLI tools (rex, sourcevision, hench, ndx). The existing shared ANSI color utility already handles TTY detection and NO_COLOR; this feature adds semantic `warn()` and `cmd()` tokens on top and applies them consistently so that any time the CLI tells a user 'run this command' or 'something may be wrong', it appears in yellow and is visually distinct from normal output."
---

## Children

| Title | Status |
|-------|--------|
| [Add yellow warn and cmd semantic tokens to the shared ANSI color utility](./add-yellow-warn-and-cmd-e6fce5.md) | completed |
| [Apply yellow formatting to all CLI warning messages, remediation hints, and recommended command strings across all packages](./apply-yellow-formatting-to-all-1778fe.md) | pending |
