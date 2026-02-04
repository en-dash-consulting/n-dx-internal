# n-dx

AI-powered development toolkit. Three packages that chain together: analyze a codebase, build a PRD, execute tasks autonomously.

## Packages

- **sourcevision** — Static analysis: file inventory, import graph, zone detection (Louvain community detection), React component catalog. Produces `.sourcevision/CONTEXT.md` and `llms.txt` for AI consumption.
- **rex** — PRD management: hierarchical epics/features/tasks/subtasks, `analyze` scans project + sourcevision output to generate proposals, `status` shows completion tree. Stores state in `.rex/prd.json`.
- **hench** — Autonomous agent: picks next rex task, builds a brief, calls Claude API or CLI in a tool-use loop, records runs in `.hench/runs/`.

## Monorepo Structure

```
packages/
  sourcevision/    # analysis engine
  rex/             # PRD + task tracker
  hench/           # autonomous agent
cli.js             # n-dx entry point (orchestration + delegation)
```

Build and test:

```sh
pnpm build          # build all packages
pnpm test           # test all packages
pnpm typecheck      # typecheck all packages
```

## n-dx Orchestration Commands

```sh
n-dx init [dir]            # sourcevision init → rex init → hench init
n-dx plan [dir]            # sourcevision analyze → rex analyze (show proposals)
n-dx plan --accept [dir]   # ...then accept proposals into PRD
n-dx work [dir]            # hench run (pass --task=ID, --dry-run, etc.)
n-dx status [dir]          # rex status (pass --format=json)
```

## Direct Tool Access

```sh
n-dx rex <command> [args]
n-dx hench <command> [args]
n-dx sourcevision <command> [args]
n-dx sv <command> [args]          # alias for sourcevision
```

### Rex commands

`init`, `status`, `next`, `add`, `update`, `validate`, `analyze`, `recommend`, `mcp`

### Sourcevision commands

`init`, `analyze`, `serve`, `validate`, `reset`, `mcp`

### Hench commands

`init`, `run`, `status`, `show`

## MCP Servers

Rex and sourcevision expose MCP servers for Claude Code tool use:

```sh
claude mcp add rex -- node packages/rex/dist/cli/index.js mcp .
claude mcp add sourcevision -- node packages/sourcevision/dist/cli/index.js mcp .
```

### Rex MCP tools

- `rex_status` — PRD tree with completion stats
- `rex_next` — next actionable task
- `rex_add` — add epic/feature/task/subtask
- `rex_update` — update item status/priority/title
- `rex_validate` — check PRD integrity
- `rex_analyze` — scan project and propose PRD items
- `rex_recommend` — get sourcevision-based recommendations

### Sourcevision MCP tools

- `sv_inventory` — file listing with metadata
- `sv_imports` — dependency graph for a file
- `sv_zones` — architectural zone map
- `sv_components` — React component catalog
- `sv_context` — full CONTEXT.md contents

## Development Workflow

1. `n-dx init .` — set up all tool directories
2. `n-dx plan .` — analyze codebase, review proposals
3. `n-dx plan --accept .` — accept proposals into PRD
4. `n-dx work .` — execute next task autonomously
5. `n-dx status .` — check progress

## Key Files

| Path | Purpose |
|------|---------|
| `.sourcevision/CONTEXT.md` | AI-readable codebase summary |
| `.sourcevision/manifest.json` | Analysis metadata and version |
| `.rex/prd.json` | PRD tree (epics → features → tasks → subtasks) |
| `.rex/workflow.md` | Human-readable workflow state |
| `.rex/config.json` | Rex project configuration |
| `.hench/config.json` | Hench agent configuration (model, max turns) |
| `.hench/runs/` | Run history and transcripts |
