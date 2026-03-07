# SourceVision Zone Hints

## Web package viewer components

Files under `packages/web/src/viewer/` are all part of the web-dashboard viewer
application, regardless of subdirectory. Specifically:

- `packages/web/src/viewer/components/elapsed-time.ts` — viewer UI component
- `packages/web/src/viewer/components/prd-tree/lazy-children.ts` — viewer UI component
- `packages/web/src/viewer/components/prd-tree/listener-lifecycle.ts` — viewer UI component
- `packages/web/src/viewer/hooks/use-tick.ts` — viewer hook
- `packages/web/src/viewer/views/task-audit.ts` — viewer view

These should NOT be grouped with build infrastructure files (`build.js`, `dev.js`,
`package.json`, `tsconfig.json`). They are consumer-facing UI code that belongs in
the web-dashboard zone.

## Build scripts vs configuration

`packages/web/build.js` and `packages/web/dev.js` are executable build runner
scripts (entrypoints), not static configuration files.
