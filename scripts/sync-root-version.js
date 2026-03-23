/**
 * Sync root package.json version with workspace packages.
 *
 * Changesets can't manage the root package (it's the workspace root, not a
 * workspace member). This script runs after `pnpm changeset version` to
 * copy the version from a workspace package (all are in a fixed group, so
 * any one will do) into the root package.json.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const ref = JSON.parse(readFileSync('packages/rex/package.json', 'utf8'));

if (root.version !== ref.version) {
  root.version = ref.version;
  writeFileSync('package.json', JSON.stringify(root, null, 2) + '\n');
  console.log(`@n-dx/core version synced to ${ref.version}`);
} else {
  console.log(`@n-dx/core already at ${root.version}, no sync needed`);
}
