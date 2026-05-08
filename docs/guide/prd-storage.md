# PRD storage layout

The PRD lives at `.rex/prd_tree/` in your project. This page is the
user-facing explanation of how items are laid out on disk, why the layout
is what it is, and how `ndx` keeps it canonical as you add and reshape
items.

If you're looking for the normative serializer/parser contract (every
field, every encoding rule), see
[`docs/architecture/prd-folder-tree-schema.md`](../architecture/prd-folder-tree-schema.md).

## Why the tree exists

The PRD is the project's source of truth. Encoding it as a folder tree of
plain markdown files means:

- It's a normal git surface — diffs, blame, code review all work without
  any custom tooling.
- Every item has a stable, human-readable address (a path under
  `.rex/prd_tree/`).
- Tools (Claude, Codex, MCP clients, the dashboard) read and write the
  same files. There's no separate database to keep in sync.

## The three rules

### Rule 1 — folder-per-branch + leaf-as-`.md`

Every PRD item is one of two shapes on disk:

- **Branch item** (has at least one child): a slug-named **folder** containing
  exactly one `index.md`. The `index.md` holds the item's frontmatter and a
  `## Children` table linking to its direct children.
- **Leaf item** (has no children): a single bare **`<slug>.md` file** at the
  parent level. The leaf file carries only its own frontmatter — no
  children listing, no inherited parent metadata.

The same rule applies at every level — epic, feature, task, subtask. A
leaf epic at the project root is `epic-slug.md`; a leaf subtask under a
task is `subtask-slug.md` next to the task's `index.md`.

```
.rex/prd_tree/
├── empty-epic.md                  ← leaf epic
├── auth/                          ← branch epic
│   ├── index.md
│   ├── login/                     ← branch feature
│   │   ├── index.md
│   │   ├── validate-email.md      ← leaf task
│   │   └── rate-limit.md          ← leaf task
│   └── signup.md                  ← leaf feature
└── dashboard/
    ├── index.md
    └── charts/
        ├── index.md
        ├── render-chart/          ← branch task
        │   ├── index.md
        │   ├── pick-colors.md     ← leaf subtask
        │   └── animate.md         ← leaf subtask
        └── export-csv.md          ← leaf task
```

The slug comes from the item's title (lowercased, hyphenated, ASCII-only,
truncated to 40 characters at a hyphen boundary). When titles collide
between siblings, the colliding items get a six-character suffix derived
from the item's id.

### Rule 2 — automatic promotion when a leaf gains children

When a leaf `<slug>.md` gets its first child (e.g. you `ndx add subtask --parent <leaf-id>`),
the item is automatically promoted to the branch shape:

1. The contents of `<slug>.md` move into a new `<slug>/index.md`.
2. The new child is written next to it (as another leaf `.md`, or as
   another branch folder if it itself has children).
3. The original `<slug>.md` is removed.

Going the other way — removing the last child of a branch — collapses
the folder back to a bare `<slug>.md` on the next save. Branches and
leaves are interchangeable; the structure follows the children.

### Rule 3 — `ndx reshape` and `ndx add` migrate, with backup

Older checkouts can carry legacy shapes from earlier `ndx` versions:

- **Bare `<title>.md` instead of `index.md`** in a folder.
- **Both `<title>.md` and `index.md`** in the same folder (dual writes).
- **`__parent*` shim fields** in a child file from the old single-child
  compaction (where a parent folder was elided to flatten a chain).
- **Phantom `index-{6hex}/` wrappers** that contain only `index.md` and
  leave their parent folder with no own content file.

Both `ndx reshape` and `ndx add` handle these automatically:

1. **Snapshot.** A timestamped copy of `.rex/prd_tree/` is written to
   `.rex/.backups/prd_tree_<ISO>/`. The 10 most-recent snapshots are
   retained.
2. **Migrate on disk.** A structural pass detects each legacy shape and
   normalizes it: phantom wrappers are merged back into their parent,
   `<title>.md` is renamed to `index.md`, bare files that have child
   siblings are wrapped into folders.
3. **Canonicalize.** The PRD is loaded (the parser still reads every
   legacy shape) and re-saved through the current serializer. The save
   writes the canonical layout and sweeps up any leftovers via the
   serializer's stale-entry cleanup.

The migration is **data-preserving**. When intent is ambiguous (e.g. two
non-`index.md` files in the same folder) the migration leaves the files
in place rather than guessing — the parser surfaces the ambiguity as a
warning so you can resolve it manually.

## What you can rely on

- **One file per item.** Every item is reachable at exactly one path —
  either `.../<slug>.md` (leaf) or `.../<slug>/index.md` (branch). No
  duplicates, no shadow copies.
- **No hidden state.** Frontmatter holds the entire item; nothing about
  the item's identity, parent, or children is encoded outside the file +
  its directory position. `__parent*` fields are not emitted by the
  current serializer.
- **Round-trip stability.** Loading the PRD and saving it again with no
  in-memory changes is a no-op on disk (incremental file writes mean
  unchanged files are skipped, reported as `filesSkipped`).
- **Backup before mutation.** Reshape and add never touch the tree
  without first copying it. If something goes wrong the backup is in
  `.rex/.backups/prd_tree_<ISO>/` — restore with
  `cp -r .rex/.backups/prd_tree_<ISO>/ .rex/prd_tree`.

## Edge cases and FAQ

**Q: I see `__parent*` fields in one of my files. Is that bad?**
A: It's a legacy shim from the old single-child compaction. The parser
reads it correctly. The next time `ndx reshape`, `ndx add`, or
`saveDocument` runs, the file is rewritten without the shim.

**Q: An item has the same id as another. What happened?**
A: Genuine PRD validation error — usually a manual edit or a faulty
import. Run `rex validate` to see all duplicates, then resolve with
`merge_items` (MCP) or `rex remove`.

**Q: Why does my leaf task have a `.md` extension while branch tasks
don't?**
A: That is the rule. A leaf is a single `.md` file; a branch is a folder
containing `index.md`. The folder name has no `.md` suffix because it's
a directory, not a file.

**Q: Can I edit a `.md` file by hand?**
A: Yes, but keep the YAML frontmatter intact (id, level, title, status
are required). The parser warns about missing fields rather than
crashing. After hand-editing, run `rex status` once to confirm the file
still parses.

**Q: What about `index-{hash}/` folders I see in old checkouts?**
A: Phantom wrappers from a buggy intermediate migration. `ndx reshape`
detects and merges them back into their parent folder.

## Related references

- Normative schema: [`docs/architecture/prd-folder-tree-schema.md`](../architecture/prd-folder-tree-schema.md)
- Storage source: `packages/rex/src/store/folder-tree-serializer.ts`,
  `packages/rex/src/store/folder-tree-parser.ts`
- Migration source: `packages/rex/src/core/folder-per-task-migration.ts`
- Backup source: `packages/rex/src/core/backup-snapshots.ts`
