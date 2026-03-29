/**
 * Sourcevision data loader for parallel worktree execution.
 *
 * Reads `.sourcevision/zones.json` and `.sourcevision/imports.json` directly
 * from disk. Defines minimal TypeScript interfaces for the data shapes needed
 * — does NOT import from the sourcevision package, preserving domain isolation
 * (rex ⊥ sourcevision).
 *
 * Gracefully returns empty data when `.sourcevision/` does not exist or
 * files are malformed, so callers always get usable (possibly empty) results.
 *
 * @module rex/parallel/sourcevision-loader
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { ZoneIndex, ImportGraph } from "./blast-radius.js";

// ── Sourcevision file-shape interfaces ──────────────────────────────────────
// Minimal types mirroring the on-disk JSON shape. Only the fields we consume
// are declared; additional properties are silently ignored.

/** Shape of a single zone entry in `.sourcevision/zones.json`. */
export interface SvZoneEntry {
  /** Zone identifier (e.g. "web-viewer", "rex-cli"). */
  id: string;
  /** File paths belonging to this zone (relative to project root). */
  files: string[];
}

/** Top-level shape of `.sourcevision/zones.json`. */
export interface SvZonesFile {
  zones: SvZoneEntry[];
}

/** Shape of a single import edge in `.sourcevision/imports.json`. */
export interface SvImportEdge {
  /** Source file path (the importer). */
  from: string;
  /** Target file path (the imported module). */
  to: string;
}

/** Top-level shape of `.sourcevision/imports.json`. */
export interface SvImportsFile {
  edges: SvImportEdge[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const SV_DIR = ".sourcevision";
const ZONES_FILE = "zones.json";
const IMPORTS_FILE = "imports.json";

// ── Loaders ──────────────────────────────────────────────────────────────────

/**
 * Load zone index from `.sourcevision/zones.json`.
 *
 * Parses the zones file and returns a `ZoneIndex` (Map of zone ID → Set of
 * file paths). Returns an empty map if the file does not exist, is unreadable,
 * or has an unexpected shape.
 *
 * @param dir - Project root directory containing `.sourcevision/`.
 * @returns ZoneIndex mapping zone IDs to their file sets.
 */
export function loadZones(dir: string): ZoneIndex {
  const zones: ZoneIndex = new Map();

  const zonesPath = join(dir, SV_DIR, ZONES_FILE);
  if (!existsSync(zonesPath)) return zones;

  try {
    const raw = JSON.parse(readFileSync(zonesPath, "utf-8"));

    // zones.json wraps the array in { zones: [...] }
    const entries: unknown[] = Array.isArray(raw) ? raw : raw?.zones;
    if (!Array.isArray(entries)) return zones;

    for (const entry of entries) {
      if (
        entry != null &&
        typeof entry === "object" &&
        "id" in entry &&
        typeof (entry as SvZoneEntry).id === "string" &&
        "files" in entry &&
        Array.isArray((entry as SvZoneEntry).files)
      ) {
        const { id, files } = entry as SvZoneEntry;
        zones.set(id, new Set(files));
      }
    }
  } catch {
    // Non-fatal — return empty zones on parse or read error
  }

  return zones;
}

/**
 * Load import graph from `.sourcevision/imports.json`.
 *
 * Parses the imports file and returns a bidirectional `ImportGraph` (Map of
 * file path → Set of connected file paths). Both directions are added for
 * each edge so that neighbor expansion works regardless of import direction.
 *
 * Returns an empty map if the file does not exist, is unreadable, or has an
 * unexpected shape.
 *
 * @param dir - Project root directory containing `.sourcevision/`.
 * @returns ImportGraph mapping file paths to their import neighbors.
 */
export function loadImports(dir: string): ImportGraph {
  const imports: ImportGraph = new Map();

  const importsPath = join(dir, SV_DIR, IMPORTS_FILE);
  if (!existsSync(importsPath)) return imports;

  try {
    const raw = JSON.parse(readFileSync(importsPath, "utf-8"));

    // imports.json wraps the array in { edges: [...] }
    const edges: unknown[] = Array.isArray(raw) ? raw : raw?.edges;
    if (!Array.isArray(edges)) return imports;

    for (const edge of edges) {
      if (
        edge != null &&
        typeof edge === "object" &&
        "from" in edge &&
        typeof (edge as SvImportEdge).from === "string" &&
        "to" in edge &&
        typeof (edge as SvImportEdge).to === "string"
      ) {
        const { from, to } = edge as SvImportEdge;

        // Bidirectional: add both directions for neighbor expansion
        if (!imports.has(from)) imports.set(from, new Set());
        imports.get(from)!.add(to);
        if (!imports.has(to)) imports.set(to, new Set());
        imports.get(to)!.add(from);
      }
    }
  } catch {
    // Non-fatal — return empty graph on parse or read error
  }

  return imports;
}

/**
 * Load both zone index and import graph from sourcevision data.
 *
 * Convenience wrapper that calls `loadZones` and `loadImports` together.
 * Returns empty data for either source independently — a missing zones file
 * does not prevent loading imports, and vice versa.
 *
 * @param dir - Project root directory containing `.sourcevision/`.
 * @returns Object with `zones` (ZoneIndex) and `imports` (ImportGraph).
 */
export function loadSourcevisionData(dir: string): {
  zones: ZoneIndex;
  imports: ImportGraph;
} {
  return {
    zones: loadZones(dir),
    imports: loadImports(dir),
  };
}
