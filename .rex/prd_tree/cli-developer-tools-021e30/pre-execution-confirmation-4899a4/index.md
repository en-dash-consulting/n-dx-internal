---
id: "4899a462-917d-4f59-baa9-cb49d1db202a"
level: "feature"
title: "Pre-Execution Confirmation Prompt for ndx self-heal"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "Before ndx self-heal begins executing tasks against discovered findings, surface an interactive confirmation prompt that lists the tasks queued for work and requires explicit user approval to proceed. Bypass the prompt when the user passes --auto/--yes or when a persistent config flag (e.g. selfHeal.autoConfirm) opts into automatic execution, preserving unattended self-heal pipelines while preventing surprise long-running runs in interactive sessions."
---

## Children

| Title | Status |
|-------|--------|
| [Add interactive task-approval prompt to ndx self-heal before execution begins](./add-interactive-task-approval-54b28d.md) | completed |
| [Wire --auto/--yes flags and selfHeal.autoConfirm config to bypass the prompt](./wire-auto-yes-flags-and-1c9a91.md) | pending |
