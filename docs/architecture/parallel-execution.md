# Parallel Worktree Execution — Architecture Document

## Overview

Parallel worktree execution enables multiple ndx tasks to run concurrently by isolating each into its own git worktree with independent `.rex/`, `.sourcevision/`, and `.hench/` state directories. The system analyzes the PRD to determine which tasks conflict (modify overlapping files) and which can safely run in parallel.

This document covers the implemented Phase 1 (conflict analysis foundation) and the design for Phase 2+ (automated worktree orchestration with single-server MCP).

---

## Phase 1: Conflict Analysis Foundation (Implemented)

### Module Structure

```
packages/rex/src/parallel/
├── index.ts                  # barrel export
├── blast-radius.ts           # per-task file impact computation
├── conflict-analysis.ts      # conflict graph + independent set detection
├── execution-plan.ts         # pipeline orchestration + formatting
└── sourcevision-loader.ts    # domain-isolated SV data reader
```

**CLI entry:** `rex parallel plan [dir]` (wired through `cli.js` → `packages/rex/src/cli/commands/parallel.ts`)

**Public API:** All types and functions re-exported through `packages/rex/src/public.ts` for downstream consumption by hench and web.

### Domain Isolation

The parallel module lives in `rex` but needs sourcevision data (zones, import graph) for accurate blast radius computation. Per the project's four-tier architecture rule ("rex and sourcevision are independent, never import each other"), the module reads `.sourcevision/zones.json` and `.sourcevision/imports.json` directly from disk via `sourcevision-loader.ts`. This module:

- Defines its own minimal TypeScript interfaces (`SvZoneEntry`, `SvImportEdge`) matching the on-disk JSON shape
- Never imports from the `sourcevision` package
- Returns empty data gracefully when `.sourcevision/` doesn't exist or files are malformed

This is consistent with the spawn-vs-gateway decision rule: the parallel module runs per-command (not hot-path), needs structured return values, and the data is already persisted to disk by sourcevision's analysis pipeline.

### Pipeline Architecture

```
PRD Items + SV Data
       │
       ▼
┌──────────────────┐
│  Blast Radius    │  Per-task file impact set
│  Computation     │  (4 signal sources)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Conflict Graph  │  Pairwise overlap detection
│  Construction    │  (3 confidence levels)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Independent Set │  Greedy graph coloring
│  Detection       │  (with sibling + blockedBy constraints)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Execution Plan  │  Groups, serial tasks, conflicts
│  Formatting      │  (text or JSON output)
└──────────────────┘
```

### Blast Radius Computation

For each actionable PRD task, the system computes the set of files it is likely to modify. Four signal sources contribute, applied in order:

| Signal | Source | What It Extracts |
|--------|--------|-----------------|
| Zone expansion | Task tags | Tags matched directly against zone IDs → all files in those zones |
| Criteria parsing | Acceptance criteria text | Regex extraction of explicit file paths (`src/foo/bar.ts`) and PascalCase module names (`PhasePanel`, `ConfigSurface`) |
| Module resolution | Zone file inventory | PascalCase names resolved to files by basename matching (PascalCase → kebab-case variant included) |
| Import neighbors | Import graph | 1-hop bidirectional expansion — files that import or are imported by any file already in the radius |
| Sibling heuristic | PRD tree structure | Tasks sharing a parent feature union their blast radii (conservative — assumes sibling tasks touch related code) |

**Design decision:** The sibling heuristic is intentionally conservative. Sibling tasks under the same feature are likely to touch related areas even when their tags/criteria don't explicitly indicate overlap. This reduces false-negative conflict detection at the cost of some parallelism reduction.

### Conflict Graph

The conflict graph is an undirected weighted graph where:
- **Nodes** = actionable task IDs
- **Edges** = detected file overlap between blast radii

Edge classification (in priority order):

| Confidence | Condition | Implication |
|-----------|-----------|-------------|
| **high** | Direct file overlap — both tasks list the same file in their blast radii | Near-certain merge conflict |
| **medium** | Shared import neighborhood — a file in task A's radius is a 1-hop import neighbor of a file in task B's radius | Likely coupling; changes may cascade |
| **low** | Same zone, different files — both tasks touch files in the same architectural zone but with no file or import overlap | Structural proximity; low merge conflict risk but review recommended |

Edge weight = number of overlapping files (for high/medium) or 1 (for low/zone-only).

### Independent Set Detection

Uses greedy graph coloring to partition tasks into groups that can run in parallel:

1. **Serial task extraction** — Tasks with `blockedBy` dependencies within the actionable set are excluded from coloring and placed in a serial queue
2. **Sibling constraint enforcement** — Tasks sharing a parent feature are merged via union-find so they receive the same color (same worktree group)
3. **Greedy coloring** — Nodes processed in decreasing degree order (most constrained first); each assigned the smallest color not used by already-colored neighbors
4. **Group formation** — Color classes become execution groups, sorted by estimated size (largest first)

**Algorithmic complexity:** O(n² × m) where n = actionable tasks, m = average blast radius size. For typical PRDs (10-50 actionable tasks), this runs in milliseconds.

### CLI Output

```
$ ndx parallel plan .

Execution Plan
══════════════

12 actionable tasks → 3 groups (max parallelism: 5)
2 tasks must run sequentially

Group 1 (5 tasks, ~847 files)
────────────────────────────────────────
  • Fix explorer file search overflow [high] (a1b2c3d4…)
  • Responsive column-priority system [high] (e5f6g7h8…)
  ...

Conflicts (4 detected)
────────────────────────────────────────
  Fix explorer file search... ↔ Responsive column-prio... [high] 12 overlapping files
    packages/web/src/viewer/views/sv-explorer.ts, packages/web/src/viewer/components/data-table.ts (+10 more)

Serial Tasks (2)
────────────────────────────────────────
  • Move config surface to Explorer /properties tab (i9j0k1l2…)
```

JSON output available via `--format=json` for programmatic consumption.

---

## Phase 2: Automated Worktree Orchestration (Design)

### Current Manual Workflow (Phase 1)

Today, parallel execution requires manual orchestration:

```sh
# 1. Analyze conflicts
ndx parallel plan .

# 2. Create worktrees manually
mkdir -p .ndx-workers/worker-a
git worktree add .ndx-workers/worker-a -b feature-a

# 3. Scope PRD per worktree (defer non-relevant tasks)
# 4. Start separate MCP servers per worktree
ndx start --port=3118 .ndx-workers/worker-a
ndx start --port=3119 .ndx-workers/worker-b

# 5. Run hench in each
ndx work --auto .ndx-workers/worker-a
ndx work --auto .ndx-workers/worker-b

# 6. Merge results
git checkout main-branch
git merge worker-a worker-b
```

### Proposed Phase 2 Command

```sh
ndx parallel run .              # auto-create worktrees, scope PRDs, spawn workers
ndx parallel run --workers=3 .  # limit concurrency
ndx parallel status .           # show worker status
ndx parallel merge .            # attempt merge of completed workers
```

### Worktree Lifecycle

```
ndx parallel run .
       │
       ▼
┌─────────────────────────┐
│  Compute Execution Plan │  (Phase 1 pipeline)
└────────────┬────────────┘
             │
     ┌───────┴───────┐
     ▼               ▼
┌──────────┐   ┌──────────┐
│ Worker A │   │ Worker B │    ... per group
│          │   │          │
│ worktree │   │ worktree │
│ scoped   │   │ scoped   │
│ PRD      │   │ PRD      │
│ ndx work │   │ ndx work │
└────┬─────┘   └────┬─────┘
     │               │
     └───────┬───────┘
             ▼
┌─────────────────────────┐
│  Conflict-Free Merge    │  git merge --no-edit
│  or Staged Review       │  (if conflicts detected, pause for human)
└─────────────────────────┘
```

### Worktree State Isolation

Each worker worktree gets:

| Directory | Source | Isolation |
|-----------|--------|-----------|
| `.rex/prd.json` | Copied from main, non-group tasks set to `deferred` | Full — each worktree has its own PRD view |
| `.sourcevision/` | Copied from main (read-only during execution) | Shared data, no writes expected |
| `.hench/config.json` | Copied from main | Full — independent run history |
| `.hench/runs/` | Empty (fresh per worker) | Full — runs are worker-scoped |
| Source files | Git worktree (copy-on-write via git) | Full — isolated branch per worker |

### PRD Reconciliation After Merge

When workers complete, their PRD state must be reconciled:

1. Each worker's `.rex/prd.json` contains task status updates (pending → completed)
2. The orchestrator collects completed task IDs from each worker
3. The main PRD is updated: `update_task_status(id, "completed")` for each
4. No structural PRD changes (add/remove/reorder) are permitted during parallel runs — only status transitions

This avoids the merge-conflict problem entirely for PRD state. Task status is idempotent — setting a task to "completed" twice is harmless.

---

## Phase 3: Single MCP Server with Worktree Scoping (Implemented)

### Problem

Phase 2's multi-server approach (one `ndx start` per worktree on different ports) works but has drawbacks:

- Port management overhead
- Each server loads its own PRD and SV data independently
- Claude Code needs reconfigured MCP URLs per worktree session
- No unified dashboard view of parallel execution

### Architecture: Session-Scoped MCP

A single MCP server running on the primary port (3117) serves all worktrees. Each MCP session is scoped to a specific worktree via the `X-Ndx-Root-Dir` header.

```
┌──────────────────────────────────────────────────┐
│            ndx start (port 3117)                 │
│                                                  │
│  ┌─────────────┐  ┌─────────────┐               │
│  │ MCP Session  │  │ MCP Session  │              │
│  │ rootDir: /a  │  │ rootDir: /b  │   ...        │
│  │ PRD: /a/.rex │  │ PRD: /b/.rex │              │
│  └──────┬──────┘  └──────┬──────┘               │
│         │                │                       │
│  ┌──────┴────────────────┴──────┐                │
│  │    Shared Infrastructure     │                │
│  │  - WebSocket broadcast       │                │
│  │  - Dashboard aggregation     │                │
│  │  - Process management        │                │
│  └──────────────────────────────┘                │
│                                                  │
│  ┌──────────────────────────────┐                │
│  │    Unified Dashboard         │                │
│  │  - Parallel execution view   │                │
│  │  - Per-worker status         │                │
│  │  - Merge readiness           │                │
│  └──────────────────────────────┘                │
└──────────────────────────────────────────────────┘
```

### Module Structure

```
packages/web/src/server/
├── routes-mcp.ts                     # Modified — session-scoped rootDir + parallel blocking
└── utils/
    ├── worktree-validation.ts        # Validates worktree paths (abs, git, .rex/, .sourcevision/)
    └── parallel-mode.ts              # Tool blocking for worktree-scoped sessions

packages/rex/src/parallel/
├── reconcile.ts                      # PRD reconciliation (worktree → main status merge)
└── index.ts                          # Updated barrel export
```

### Session Initialization

When a worktree-scoped session connects:

```
POST /mcp/rex
Headers:
  Mcp-Session-Id: <auto-generated>
  X-Ndx-Root-Dir: /path/to/worktree    ← new header

Server behavior:
  1. Resolve rootDir to absolute path
  2. Validate it's a git worktree of the primary repo (worktree-validation.ts)
  3. Create MCP server with PRDStore scoped to rootDir/.rex/
  4. Apply parallel-mode tool blocking (parallel-mode.ts)
  5. Store rootDir on the McpSession object
  6. All subsequent MCP tool calls in this session read/write from rootDir
```

### Worktree Validation (`worktree-validation.ts`)

The validator performs 6 sequential checks, returning a discriminated union (`ok: true | ok: false`):

| Check | Error Field | What It Verifies |
|-------|-------------|------------------|
| 1 | `path_not_absolute` | Path is absolute (not relative) |
| 2 | `path_not_found` | Path exists and is a directory |
| 3 | `not_git_repo` | `.git` file or directory exists at path |
| 4 | `not_valid_worktree` | Path is the primary repo root or appears in `git worktree list --porcelain` output |
| 5 | `missing_rex` | `.rex/` directory exists in the worktree |
| 6 | `missing_sourcevision` | `.sourcevision/` directory exists in the worktree |

The validator uses dependency injection (`WorktreeValidationDeps`) for testability — tests inject stubs for `existsSync`, `statSync`, `readFileSync`, and `execFileSync`.

### Parallel-Mode Tool Blocking (`parallel-mode.ts`)

When a session is initialized with `X-Ndx-Root-Dir`, it enters parallel mode. Structural PRD mutation tools are blocked to prevent conflicts across worktrees.

**Allowed Rex tools in parallel mode:**

| Tool | Reason |
|------|--------|
| `get_prd_status` | Read-only — PRD overview |
| `get_next_task` | Read-only — task selection |
| `get_item` | Read-only — item detail |
| `update_task_status` | Status transitions only (in_progress → completed) |
| `append_log` | Append-only logging |
| `health` | Read-only — health score |
| `facets` | Read-only — facet overview |
| `get_capabilities` | Read-only — server capabilities |

**Blocked Rex tools (structural mutations):**

`add_item`, `edit_item`, `move_item`, `merge_items`, `reorganize`, `verify_criteria`, `get_recommendations`, `sync_with_remote`

Blocked tools remain visible in `listTools` responses (client can discover them) but return `isError: true` with a clear `parallel_mode_restricted` error message.

Implementation uses `applyParallelModeBlocking()` which iterates `server._registeredTools` and replaces blocked handlers with error-returning stubs via `update({ callback })`.

### MCP Route Handler Changes (`routes-mcp.ts`)

The `McpSession` interface now includes an optional `rootDir` field:

```typescript
interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActivityAt: number;
  rootDir?: string;  // ← new: worktree root override
}
```

On session initialization (`POST /mcp/rex` or `/mcp/sourcevision` without `Mcp-Session-Id`):

1. Check for `X-Ndx-Root-Dir` header
2. If present, validate via `validateWorktree()`
3. If valid, create MCP server with `rootDir` as `cwd`
4. Apply `applyParallelModeBlocking()` for Rex sessions
5. Store `rootDir` on the session object

### PRD Reconciliation (`reconcile.ts`)

After a worktree completes its work, status changes must be propagated back to the main PRD. The reconciler handles this:

**Reconcilable statuses:** Only `completed` and `failing` are propagated back. Intermediate states (`in_progress`, `pending`, `deferred`, `blocked`) are ignored — they represent transient worktree state, not work results.

**Reconciliation pipeline:**

```
detectChanges(mainDoc, worktreeDoc)
    ↓
  Walks worktree PRD tree
  Compares each item's status to main PRD
  Filters to reconcilable statuses only
  Skips items not found in main (worktree-only additions)
    ↓
applyChanges(store, changes, worktreeDoc)
    ↓
  For each change:
    1. Validate transition (mainStatus → worktreeStatus) via validateTransition()
    2. Compute timestamp updates (startedAt, completedAt) via computeTimestampUpdates()
    3. Copy resolution metadata (failureReason, resolutionType, resolutionDetail)
    4. Apply via store.updateItem()
    ↓
  Returns: { reconciled[], conflicts[] }
```

**Conflict handling:** If a status transition is not allowed (e.g., main PRD already moved the item to `completed` while the worktree was running), the change is recorded as a conflict with a reason. Conflicts are logged via `store.appendLog()` with event `parallel_reconcile_conflict`.

**CLI access:** `rex parallel reconcile <worktree-path> [main-dir]`

### Implementation Considerations

| Concern | Approach |
|---------|----------|
| PRD isolation | Each session instantiates its own `PRDStore` pointed at `rootDir/.rex/prd.json` |
| SV data | Read from `rootDir/.sourcevision/` — immutable during parallel runs |
| Process spawning | `spawnManaged` receives `cwd: rootDir` so CLI tools operate in the worktree |
| WebSocket broadcasts | Scoped by session group — workers don't receive each other's `rex:item-updated` messages |
| Dashboard | New "Parallel Runs" view aggregates status across all active worktree sessions (future work) |
| Cleanup | Session disconnect triggers worktree cleanup (configurable: keep or remove) |
| Permissions | `.claude/settings.local.json` must be copied to worktrees — hench agents inherit allowed commands and MCP tool permissions from this file |

### Claude Code / Hench Permissions for Worktrees

**Critical for worktree agent operation:** The `.claude/settings.local.json` file must be present in the worktree for the hench agent's Claude Code subprocess to have the correct permissions. This file defines:

- **Bash command permissions:** `pnpm:*`, `node:*`, `npx:*`, `git:*`, `go:*`, and filesystem utilities
- **MCP tool permissions:** All `mcp__rex__*` and `mcp__sourcevision__*` tools

When creating a worktree for parallel execution, the setup script must copy `.claude/settings.local.json` from the main repo root. Without this, the agent session will prompt for permission on every command, effectively blocking automated execution.

### Test Coverage

```
packages/web/tests/unit/server/
├── worktree-validation.test.ts       # Path validation, git checks, missing directories
├── parallel-mode.test.ts             # Tool blocking, allowed set, error messages
└── routes-mcp.test.ts                # Session scoping, header handling (updated)

packages/web/tests/integration/
└── mcp-session-scoping.test.ts       # End-to-end session isolation, parallel mode

packages/rex/tests/unit/parallel/
└── reconcile.test.ts                 # Status detection, conflict handling, metadata copy
```

---

## Concurrency Safety

### File-Level Locks

The parallel execution system introduces new concurrent access patterns:

| Resource | Writers | Safety |
|----------|---------|--------|
| Main `.rex/prd.json` | Orchestrator (status reconciliation only) | Safe — atomic writes, no concurrent workers |
| Worker `.rex/prd.json` | Single hench per worker | Safe — one writer per worktree |
| `.sourcevision/` | None during parallel runs | Safe — read-only |
| Source files | One worker per file (enforced by blast radius partitioning) | Safe by design |
| `.hench/runs/` | One hench per worker (separate directories) | Safe — no sharing |

### Race Condition Mitigations

1. **Double-start prevention:** The orchestrator checks for `.ndx-parallel.lock` before creating workers. Only one `ndx parallel run` can be active per project.
2. **Worker crash recovery:** If a worker's hench process exits non-zero, its worktree is preserved (not auto-deleted) and its tasks are reset to `pending` in the main PRD.
3. **Merge conflict detection:** Before merging, `git merge --no-commit` is attempted. If conflicts exist, the merge is aborted and the user is prompted with the specific files.

---

## Relationship to Existing Architecture

### Tier Placement

```
Orchestration    cli.js (ndx parallel plan/run/merge)     ← spawns rex CLI
     ↓
Execution        hench (one instance per worker)           ← unchanged
     ↓
Domain           rex/src/parallel/*                        ← new module
                 rex/src/cli/commands/parallel.ts           ← new CLI command
     ↓
Foundation       @n-dx/llm-client                          ← unchanged
```

The parallel module is a pure domain-tier addition to rex. It has no LLM dependency (no API calls, no token usage). The orchestration layer (`cli.js`) spawns `rex parallel plan` exactly like it spawns other rex commands.

### Gateway Compliance

The parallel module does not introduce any new cross-package imports:
- `blast-radius.ts` imports only from `../schema/v1.js` (same package)
- `sourcevision-loader.ts` reads JSON from disk (no imports)
- No hench or web imports

If web needs to consume the execution plan (e.g. for a dashboard "Parallel Runs" view), it would go through `web/src/server/rex-gateway.ts` — re-exporting `computeExecutionPlan` and `FormattedExecutionPlan` from rex's public API.

### Test Coverage

```
packages/rex/tests/unit/parallel/
├── blast-radius.test.ts          # 31 tests — all 4 signal sources + end-to-end
├── conflict-analysis.test.ts     # 26 tests — graph construction, coloring, constraints
├── execution-plan.test.ts        # 16 tests — pipeline integration, formatting, edge cases
└── sourcevision-loader.test.ts   # Tests for file reading, malformed data, missing files
```

Total: 73+ unit tests covering the complete pipeline.

---

## Future Considerations

### Blast Radius Accuracy Improvements

The current blast radius relies on static signals (tags, criteria text, zones, imports). Potential enhancements:

- **Historical run data:** Analyze `.hench/runs/` to see which files previous executions of similar tasks actually modified. Weight blast radius toward empirically observed patterns.
- **Git blame integration:** For tasks referencing specific functions or classes, use git blame to identify the files where those symbols are defined.
- **LLM-assisted estimation:** For tasks with vague descriptions, use a fast LLM call to predict likely file modifications. This would be the first LLM dependency in the parallel module and should be opt-in (`--smart` flag).

### Dashboard Integration

The web dashboard could provide a visual execution plan view:

- Conflict graph visualization (nodes = tasks, edges = conflicts, colored by group)
- Worker status monitoring (live progress per worktree)
- Merge readiness indicators
- One-click merge for conflict-free completions

This would live in `packages/web/src/viewer/views/parallel.ts` and consume the execution plan via the rex gateway.
