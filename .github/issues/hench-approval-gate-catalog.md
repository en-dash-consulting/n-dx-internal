## Problem

When hench runs autonomously, it frequently hits Claude Code permission approval gates for commands like `pnpm build`, `pnpm test`, `go test`, etc. The agent retries the same command repeatedly, wastes tokens, and eventually gives up — often proceeding to commit untested code or abandoning the task entirely.

The user has no visibility into which commands were blocked until they manually review the full agent transcript, which can be hundreds of lines long.

## Observed Behavior

From a recent hench run:

```
[Agent]    I need approval from the user to run build/test commands.
[Tool]     Bash({"command":"pnpm build","description":"Build project"})
[Tool]     Bash({"command":"pnpm build && pnpm test --filter sourcevision"})
[Tool]     Bash({"command":"pnpm build && pnpm test --filter sourcevision"})
[Tool]     Bash({"command":"pnpm build && pnpm test --filter sourcevision"})
[Agent]    I keep hitting an approval gate. Let me try the individual parts:
[Tool]     Bash({"command":"pnpm build"})
[Agent]    I'm unable to run build/test commands due to an approval gate.
```

The agent burned multiple tool calls on the same blocked command with no actionable output for the user.

## Expected Behavior

Hench should:

1. **Detect** when a command fails due to a permission/approval gate (distinct from a command that fails with a non-zero exit code)
2. **Catalog** each unique blocked command during the run (deduplicated)
3. **Stop retrying** the same blocked command — move on or find an alternative approach
4. **Report** at the end of the run a clear summary of all blocked commands

### Example end-of-run output

```
Run complete. 3 commands were blocked by approval gates:

  pnpm build
  pnpm test --filter sourcevision
  go test ./...

To allow these commands, add them to .claude/settings.local.json:

  {
    "permissions": {
      "allow": [
        "Bash(pnpm build:*)",
        "Bash(pnpm test:*)",
        "Bash(go test:*)"
      ]
    }
  }

Or run in a more permissive mode: claude --dangerously-skip-permissions
```

## Implementation Notes

- The approval gate signal needs to be identified from the Claude Code tool response — look for the specific error/rejection pattern returned when a Bash command is denied
- Blocked commands should be stored in the run's state (e.g., `run.blockedCommands: string[]`) and deduplicated by command prefix
- The permission suggestion should generate the minimal `Bash(prefix:*)` patterns that would cover the blocked commands
- This pairs well with the existing run summary output in `.hench/runs/`

## Acceptance Criteria

- [ ] Hench detects permission-denied responses from Bash tool calls
- [ ] Blocked commands are cataloged (deduplicated) during the run
- [ ] Agent does not retry the exact same command more than once after a permission denial
- [ ] End-of-run output includes a "Blocked Commands" section when any exist
- [ ] The output includes copy-pasteable `settings.local.json` permissions to unblock
- [ ] Blocked command data is persisted in the run record for later review
