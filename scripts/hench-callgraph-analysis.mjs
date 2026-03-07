/**
 * Hench intra-package call-graph analysis script.
 *
 * Analyzes callgraph.json to detect circular call patterns between
 * hench subdirectories (agent/, prd/, tools/, etc.).
 *
 * Each edge in callgraph.json represents a single call site (no callCount
 * field), so we count edges rather than summing a weight.
 */

import { readFileSync } from "fs";

const cg = JSON.parse(readFileSync(".sourcevision/callgraph.json", "utf-8"));

// Filter to hench src files only — both caller and callee must be in hench/src/
const henchEdges = cg.edges.filter(
  (e) =>
    e.callerFile?.startsWith("packages/hench/src/") &&
    e.calleeFile?.startsWith("packages/hench/src/"),
);

// Extract first-level subdirectory from path
function subdir(path) {
  const rel = path.replace("packages/hench/src/", "");
  // Files directly in src/ (e.g. public.ts) get subdir "."
  const slash = rel.indexOf("/");
  return slash === -1 ? "." : rel.slice(0, slash);
}

// Build directory-level edge counts
const dirCalls = new Map();
for (const edge of henchEdges) {
  const from = subdir(edge.callerFile);
  const to = subdir(edge.calleeFile);
  const key = `${from} -> ${to}`;
  dirCalls.set(key, (dirCalls.get(key) || 0) + 1);
}

// Sort by count descending
const sorted = [...dirCalls.entries()].sort((a, b) => b[1] - a[1]);

console.log("Hench intra-package call graph (directory level):");
console.log(`Total internal edges: ${henchEdges.length}`);
console.log("");

// Separate internal vs cross-directory
const crossDir = [];
const internal = [];
for (const [key, count] of sorted) {
  const parts = key.split(" -> ");
  if (parts[0] === parts[1]) {
    internal.push({ key, count });
  } else {
    crossDir.push({ key, count, from: parts[0], to: parts[1] });
  }
}

console.log("=== Cross-directory calls ===");
for (const { key, count } of crossDir) {
  console.log(`  ${key.padEnd(40)} ${String(count).padStart(5)}`);
}

console.log("\n=== Internal calls ===");
for (const { key, count } of internal) {
  console.log(`  ${key.padEnd(40)} ${String(count).padStart(5)}`);
}

// Detect circular patterns at directory level
console.log("\n=== Circular pattern detection ===");
const adjacency = new Map();
for (const { from, to, count } of crossDir) {
  if (!adjacency.has(from)) adjacency.set(from, []);
  adjacency.get(from).push({ to, count });
}

const cycles = [];
for (const [a, targets] of adjacency) {
  for (const { to: b, count: countAB } of targets) {
    const reverse = adjacency.get(b);
    if (reverse) {
      const reverseEdge = reverse.find((r) => r.to === a);
      if (reverseEdge) {
        const key = [a, b].sort().join(" <-> ");
        if (!cycles.find((c) => c.key === key)) {
          cycles.push({
            key,
            a,
            b,
            abCount: countAB,
            baCount: reverseEdge.count,
            total: countAB + reverseEdge.count,
          });
        }
      }
    }
  }
}

if (cycles.length === 0) {
  console.log("  No circular patterns detected.");
} else {
  cycles.sort((a, b) => b.total - a.total);
  for (const cycle of cycles) {
    console.log(
      `  CYCLE: ${cycle.a} <-> ${cycle.b} (${cycle.abCount} + ${cycle.baCount} = ${cycle.total} calls)`,
    );
  }
}

// File-level detail for any cycles found
if (cycles.length > 0) {
  console.log("\n=== File-level cycle detail ===");
  for (const cycle of cycles) {
    console.log(`\n  ${cycle.a} <-> ${cycle.b}:`);

    const abEdges = henchEdges.filter(
      (e) =>
        subdir(e.callerFile) === cycle.a && subdir(e.calleeFile) === cycle.b,
    );
    // Group by file pair
    const abGroups = new Map();
    for (const e of abEdges) {
      const k = `${e.callerFile} -> ${e.calleeFile}`;
      abGroups.set(k, (abGroups.get(k) || 0) + 1);
    }
    console.log(`    ${cycle.a} -> ${cycle.b}:`);
    for (const [k, c] of [...abGroups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`      ${k} (${c} calls)`);
    }

    const baEdges = henchEdges.filter(
      (e) =>
        subdir(e.callerFile) === cycle.b && subdir(e.calleeFile) === cycle.a,
    );
    const baGroups = new Map();
    for (const e of baEdges) {
      const k = `${e.callerFile} -> ${e.calleeFile}`;
      baGroups.set(k, (baGroups.get(k) || 0) + 1);
    }
    console.log(`    ${cycle.b} -> ${cycle.a}:`);
    for (const [k, c] of [...baGroups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`      ${k} (${c} calls)`);
    }
  }
}

// Also check import-level cycles (the callgraph may not capture re-exports)
console.log("\n=== Import-level cross-directory analysis ===");
console.log("(Detected from source code, not callgraph.json)");

// The following cycle was found via manual import analysis:
// process/exec-shell.ts re-exports from tools/exec-shell.ts
// tools/exec-shell.ts imports from process/exec.ts
// tools/rex.ts imports execShellCmd from process/index.ts
// tools/test-runner.ts imports execShellCmd from process/index.ts
//
// This creates a directory-level cycle: process <-> tools
console.log("  process <-> tools: directory-level import cycle");
console.log("    process/exec-shell.ts re-exports from tools/exec-shell.ts");
console.log("    tools/exec-shell.ts imports exec from process/exec.ts");
console.log("    tools/rex.ts imports execShellCmd from process/index.ts");
console.log("    tools/test-runner.ts imports execShellCmd from process/index.ts");
