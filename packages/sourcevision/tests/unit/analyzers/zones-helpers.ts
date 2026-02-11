import type {
  Inventory,
  Imports,
  ImportEdge,
  FileEntry,
  Zone,
} from "../../../src/schema/index.js";

// ── Data Helpers ────────────────────────────────────────────────────────────

export function makeFileEntry(path: string, overrides?: Partial<FileEntry>): FileEntry {
  return {
    path,
    size: 100,
    language: "TypeScript",
    lineCount: 10,
    hash: "abc123",
    role: "source",
    category: "misc",
    ...overrides,
  };
}

export function makeInventory(files: FileEntry[]): Inventory {
  return {
    files,
    summary: {
      totalFiles: files.length,
      totalLines: files.reduce((s, f) => s + f.lineCount, 0),
      byLanguage: {},
      byRole: {},
      byCategory: {},
    },
  };
}

export function makeEdge(from: string, to: string, symbols = ["default"]): ImportEdge {
  return { from, to, type: "static", symbols };
}

export function makeImports(edges: ImportEdge[]): Imports {
  return {
    edges,
    external: [],
    summary: {
      totalEdges: edges.length,
      totalExternal: 0,
      circularCount: 0,
      circulars: [],
      mostImported: [],
      avgImportsPerFile: 0,
    },
  };
}

export function makeZone(id: string, files: string[], overrides?: Partial<Zone>): Zone {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    description: `${files.length} files`,
    files,
    entryPoints: files.length > 0 ? [files[0]] : [],
    cohesion: 0.8,
    coupling: 0.2,
    ...overrides,
  };
}
