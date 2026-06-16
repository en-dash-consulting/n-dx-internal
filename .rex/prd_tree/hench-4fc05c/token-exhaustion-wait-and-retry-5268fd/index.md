---
id: "5268fd14-39e9-4408-bff9-93a693277beb"
level: "feature"
title: "Token Exhaustion Wait-and-Retry and Ctrl+C-Only Rollback Prompt"
status: "completed"
source: "smart-add"
startedAt: "2026-06-16T22:02:59.220Z"
completedAt: "2026-06-16T22:13:51.346Z"
endedAt: "2026-06-16T22:13:51.346Z"
acceptanceCriteria: []
description: "Replace the current automatic rollback prompt on run failure with differentiated behavior: when the failure is an insufficient-token / rate-limit error, suppress the rollback prompt entirely and instead emit a single status message that the run is waiting for token replenishment before retrying. For any other run error, emit a clear failure notification and terminate the loop without prompting for rollback. The rollback prompt should only appear in response to a Ctrl+C interrupt, and the interrupt itself should prompt the user (Y/n) before actually canceling — any non-Y input on the initial interrupt cancels the loop/run/command immediately without rollback."
---

## Children

| Title | Status |
|-------|--------|
| [Cancel hench run loop on non-token errors with notification and no rollback prompt](./cancel-hench-run-loop-on-non-5a6555.md) | completed |
| [Extract token-refresh timestamp from insufficient-token API error responses](./extract-token-refresh-timestamp-abff44.md) | completed |
| [Implement idle wait-until-refresh and single-retry loop exit for token exhaustion](./implement-idle-wait-until-633946.md) | completed |
| [Restrict rollback prompt to Ctrl+C interrupts with Y/n confirmation and immediate cancel on any other input](./restrict-rollback-prompt-to-c4ac8f.md) | completed |
| [Suppress rollback prompt on insufficient-token errors and emit single token-replenishment wait message](./suppress-rollback-prompt-on-1ae99d.md) | completed |
