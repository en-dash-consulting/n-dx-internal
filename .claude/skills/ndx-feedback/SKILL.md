---
name: ndx-feedback
description: Submit feedback, bug reports, or feature requests for n-dx
argument-hint: "[description]"
---

Submit feedback about n-dx — bug reports, feature requests, suggestions, or general observations.

## Process

1. If a description is provided, use it. Otherwise, ask the user what feedback they'd like to share.
2. Categorize the feedback:
   - **Bug** — something broken, unexpected behavior, error messages
   - **Feature request** — new capability or workflow improvement
   - **Improvement** — enhancement to existing functionality
   - **Question** — confusion about how something works (may indicate a docs gap)
3. Draft a GitHub issue with:
   - Clear title (concise, actionable)
   - Description with context (what happened, what was expected, steps to reproduce for bugs)
   - Relevant labels: `bug`, `enhancement`, `question`, or `documentation`
   - For bugs: include n-dx version, Node version, OS if relevant
4. Present the draft to the user for review before submitting
5. Create the issue using `gh issue create` on `en-dash-consulting/n-dx`
6. If `gh` is not available or auth fails, provide the formatted issue content for manual submission

## Context gathering

When creating a bug report, automatically include:
- n-dx version from `package.json` or `ndx --version`
- Node.js version
- OS platform
- Relevant config (sanitized — no API keys)
- Recent error output if available from conversation context

## Labels

| Category | Label |
|----------|-------|
| Bug | `bug` |
| Feature request | `enhancement` |
| Improvement | `enhancement` |
| Question / docs gap | `question` |
| UX / ergonomics | `ux` |

## Example

User: "ndx init keeps asking me for the provider even though I already configured it"

→ Creates issue:
```
Title: ndx init prompts for provider when config already exists
Labels: bug, ux
Body:
## Description
Running `ndx init .` on an already-initialized project still prompts for
LLM provider selection, even though `.n-dx.json` already has `llm.vendor` set.

## Expected behavior
Init should detect existing config and skip the provider prompt.

## Environment
- n-dx: 0.1.8
- Node: v20.19.2
- OS: macOS 14.6
```
