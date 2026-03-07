# Hench Call-Graph Analysis Findings

Date: 2026-03-07

## Analysis Method

Ran intra-package call-graph analysis on `packages/hench/src/` using
`callgraph.json` (654 internal edges) supplemented by manual import-graph
inspection.

## Subdirectory Dependency Map

```
cli ──────→ store, schema, prd, agent, queue, process, types
agent ─────→ types, store, tools, prd, process, validation, schema
tools ─────→ process, guard, prd, validation
validation → process
store ─────→ schema
schema ────→ process  (type-only, erased at compile time)
process ───→ tools    (re-export only — see finding below)
```

Directions without an arrow (guard, queue, types, shared, prd) have no
outgoing cross-directory imports.

## Finding 1: process/ <-> tools/ import cycle (LOW severity)

**Pattern:**

- `process/exec-shell.ts` re-exports `execShell` from `tools/exec-shell.ts`
  (backward-compatibility shim, noted in the file's own doc comment).
- `tools/exec-shell.ts` imports `exec` from `process/exec.ts`.
- `tools/rex.ts` and `tools/test-runner.ts` import `execShellCmd` from
  `process/index.ts`.

This creates a **directory-level import cycle** (`process <-> tools`), though
at the _file_ level there is no true cycle because `process/exec-shell.ts` and
`process/exec.ts` are distinct files that do not import each other.

**Runtime risk:** Low. Node ESM resolves this fine because the re-export shim
(`process/exec-shell.ts`) only re-exports from tools and never triggers a
circular initialization.

**Remediation plan:**

1. Delete `packages/hench/src/process/exec-shell.ts` (the re-export shim).
2. Remove its re-export from `packages/hench/src/process/index.ts` (line 21-22).
3. Update any remaining consumers that import `execShell` from
   `process/exec-shell` or `process/index` to import from `tools/exec-shell`
   directly.
4. Run `pnpm typecheck` to verify no broken references.

This eliminates the only cross-directory cycle in hench. Estimated effort:
< 30 minutes.

## Finding 2: No circular call patterns between agent/, prd/, tools/

The call graph shows a clean one-way flow:

```
cli → agent → tools → process
         ↓       ↓
        prd    guard
         ↓
       validation → process
```

The originally feared cycle between `agent/`, `prd/`, and `tools/` does **not**
exist. The `tools/rex.ts` → `prd/rex-gateway.ts` dependency is one-way (tools
calls into prd, prd never calls tools).

## Finding 3: Zone ID inconsistency between analysis passes

Zone IDs in `zones.json` use `:` as a sub-analysis separator (e.g.,
`packages-rex:cli`) but zone output directories in `.sourcevision/zones/`
replace `:` with `-` (e.g., `packages-rex-cli`) because `:` is invalid in
Windows paths. Additionally, nested sub-zones with `/` separators use only the
last path segment as the directory name.

A CI step (`zone-id-consistency`) now validates that:
- Every top-level zone in `zones.json` has a corresponding output directory
- Every output directory corresponds to a zone in `zones.json`

This catches zone ID drift between the zone detection pass and the output
emission pass.

## Metrics Summary

| Subdirectory | Internal calls | Outgoing calls | Incoming calls |
|-------------|---------------|----------------|----------------|
| cli         | 261           | 62             | 0              |
| agent       | 125           | 98             | 6              |
| store       | 36            | 7              | 42             |
| tools       | 24            | 14             | 12             |
| process     | 17            | 0              | 11             |
| queue       | 5             | 0              | 6              |
| guard       | 3             | 0              | 1              |
| types       | 0             | 0              | 56             |
| schema      | 0             | 0              | 7              |
| prd         | 0             | 0              | 30             |
| validation  | 0             | 2              | 5              |
