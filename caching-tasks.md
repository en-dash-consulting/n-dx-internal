# Smart prune proposal caching

Add LLM proposal caching to `rex prune --smart` so that `--dry-run` proposals are reusable by `--accept` without re-calling the LLM.

## File to modify
`packages/rex/src/cli/commands/prune.ts`

## Pattern to follow
Copy the caching pattern from `packages/rex/src/cli/commands/reshape.ts` lines 18-54:
- `PENDING_SMART_PRUNE_FILE = "pending-smart-prune.json"` constant
- `PendingSmartPruneCache` interface with `generatedAt`, `prdHash`, `proposals` fields
- `hashPRD()` function using `createHash("sha256")` on `toCanonicalJSON(items)`
- `savePendingSmartPrune()`, `loadPendingSmartPrune()`, `clearPendingSmartPrune()` async functions

## Changes to `smartPrune()` function
1. Add `fresh` flag parsing: `const fresh = flags.fresh === "true"`
2. Before the LLM call (`reasonForReshape`), compute `currentHash = hashPRD(doc.items)` and check cache. If `!fresh` and cached hash matches, use cached proposals and log "Using cached proposals from previous dry run."
3. If cached but hash doesn't match, warn "PRD has changed since proposals were generated. Regenerating." and clear cache.
4. After LLM call, cache proposals with `savePendingSmartPrune(rexDir, proposals, currentHash)`.
5. After successful apply (line ~548 `store.saveDocument(doc)`), call `clearPendingSmartPrune(rexDir)`.

## New imports needed
- Add `readFile`, `unlink` to the existing `node:fs/promises` import (currently uses dynamic import for readFile — move to top-level static import)
- Add `import { createHash } from "node:crypto"`
- `toCanonicalJSON` is already imported
- Add `warn` to the `../output.js` import

---

# Smart-add PRD hash validation

Add PRD hash validation to `rex add` (smart-add) pending proposal cache so stale proposals are detected when the PRD changes between generation and acceptance.

## File to modify
`packages/rex/src/cli/commands/smart-add.ts`

## Current state
`savePending()` at line 657 saves `{ proposals, parentId }` without any hash. `tryAcceptCachedProposals()` at line 975 loads and applies without checking staleness.

## Changes

### Add imports
- `import { createHash } from "node:crypto"`
- `import { toCanonicalJSON } from "../../core/canonical.js"`

### Add hash function
Same `hashPRD()` as reshape.ts: `createHash("sha256").update(toCanonicalJSON(items)).digest("hex").slice(0, 12)`

### Update `savePending()` (line 657)
Add `prdHash` parameter and include it in the serialized object: `{ proposals, parentId, prdHash }`.

### Update `loadPending()` (line 666)
Update return type to include optional `prdHash?: string`.

### Update `tryAcceptCachedProposals()` (line 975)
After loading cached proposals, load the current PRD, compute hash, and compare with `cached.prdHash`. If mismatch, call `warn("PRD has changed since proposals were generated. Clearing stale cache.")`, clear pending, and return false. If no hash in cache (backwards compat), proceed without validation.

### Update `savePending` call sites
Two call sites need to pass the hash:
1. ~line 1140: `await savePending(dir, proposals, parentId)` — need to compute and pass hash
2. ~line 1326: `await savePending(dir, rejected, parentId)` — need to compute and pass hash

Both sites need access to the current PRD items to compute the hash. The items are available from the store loaded earlier in the call chain.
