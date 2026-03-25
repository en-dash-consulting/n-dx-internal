---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/web": patch
"@n-dx/llm-client": patch
"@n-dx/sourcevision": patch
---

### Rex
- Proactive PRD structure health checks with configurable thresholds
- Post-write health warnings on `rex add` and `rex analyze`
- Structure health gate in `ndx ci` (fails below score 50)

### Web Dashboard
- Checkbox multi-select: hover reveals checkbox, click row opens detail panel
- Remove Edit icon from tree rows (detail panel handles editing)
- Completion timeline view with date range filters (today/week/month/all)

### CLI
- Fix release workflow: use `npx` for changeset commands (pnpm script resolution bug)
