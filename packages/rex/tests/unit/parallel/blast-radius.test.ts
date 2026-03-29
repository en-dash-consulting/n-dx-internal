import { describe, it, expect } from "vitest";
import type { PRDItem } from "../../../src/schema/v1.js";
import type { ZoneIndex, ImportGraph } from "../../../src/parallel/blast-radius.js";
import {
  blastRadius,
  expandZoneTags,
  extractPathsFromCriteria,
  resolveModuleNames,
  expandImportNeighbors,
} from "../../../src/parallel/blast-radius.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<PRDItem> = {}): PRDItem {
  return {
    id: "task-1",
    title: "Test Task",
    status: "pending",
    level: "task",
    ...overrides,
  };
}

function makeFeature(
  id: string,
  children: PRDItem[],
  overrides: Partial<PRDItem> = {},
): PRDItem {
  return {
    id,
    title: `Feature ${id}`,
    status: "pending",
    level: "feature",
    children,
    ...overrides,
  };
}

function makeZoneIndex(zones: Record<string, string[]>): ZoneIndex {
  const index: ZoneIndex = new Map();
  for (const [id, files] of Object.entries(zones)) {
    index.set(id, new Set(files));
  }
  return index;
}

function makeImportGraph(edges: Record<string, string[]>): ImportGraph {
  const graph: ImportGraph = new Map();
  for (const [file, neighbors] of Object.entries(edges)) {
    graph.set(file, new Set(neighbors));
  }
  return graph;
}

// ── Signal 1: Zone-based expansion ──────────────────────────────────────────

describe("expandZoneTags", () => {
  it("expands a tag matching a zone ID to its file set", () => {
    const zones = makeZoneIndex({
      "web-viewer": ["src/viewer/app.tsx", "src/viewer/index.ts"],
      "web-server": ["src/server/main.ts"],
    });

    const result = expandZoneTags(["web-viewer"], zones);

    expect(result).toEqual(new Set(["src/viewer/app.tsx", "src/viewer/index.ts"]));
  });

  it("merges files from multiple zone tags", () => {
    const zones = makeZoneIndex({
      "web-viewer": ["src/viewer/app.tsx"],
      "web-server": ["src/server/main.ts"],
    });

    const result = expandZoneTags(["web-viewer", "web-server"], zones);

    expect(result).toEqual(new Set(["src/viewer/app.tsx", "src/server/main.ts"]));
  });

  it("ignores tags that do not match any zone", () => {
    const zones = makeZoneIndex({
      "web-viewer": ["src/viewer/app.tsx"],
    });

    const result = expandZoneTags(["unknown-zone", "also-unknown"], zones);

    expect(result.size).toBe(0);
  });

  it("handles empty tags array", () => {
    const zones = makeZoneIndex({
      "web-viewer": ["src/viewer/app.tsx"],
    });

    const result = expandZoneTags([], zones);

    expect(result.size).toBe(0);
  });
});

// ── Signal 2: Acceptance criteria parsing ───────────────────────────────────

describe("extractPathsFromCriteria", () => {
  it("extracts explicit file paths from criteria text", () => {
    const { filePaths } = extractPathsFromCriteria([
      "Function should be defined in src/parallel/blast-radius.ts",
      "Update packages/rex/src/public.ts to re-export",
    ]);

    expect(filePaths).toContain("src/parallel/blast-radius.ts");
    expect(filePaths).toContain("packages/rex/src/public.ts");
  });

  it("extracts file paths from backtick-delimited code spans", () => {
    const { filePaths } = extractPathsFromCriteria([
      "Create `src/parallel/blast-radius.ts` with the blast radius function",
    ]);

    expect(filePaths).toContain("src/parallel/blast-radius.ts");
  });

  it("ignores URLs", () => {
    const { filePaths } = extractPathsFromCriteria([
      "See http://example.com/foo.ts for reference",
      "Visit https://docs.example.com/guide.md",
    ]);

    expect(filePaths.size).toBe(0);
  });

  it("extracts PascalCase module names", () => {
    const { moduleNames } = extractPathsFromCriteria([
      "BlastRadius module should export the main function",
      "RequestDedup class needs an update",
    ]);

    expect(moduleNames).toContain("BlastRadius");
    expect(moduleNames).toContain("RequestDedup");
  });

  it("handles empty criteria array", () => {
    const { filePaths, moduleNames } = extractPathsFromCriteria([]);

    expect(filePaths.size).toBe(0);
    expect(moduleNames.size).toBe(0);
  });

  it("extracts paths with various extensions", () => {
    const { filePaths } = extractPathsFromCriteria([
      "Update src/components/App.tsx and src/styles/main.css",
      "Check config/settings.json",
    ]);

    expect(filePaths).toContain("src/components/App.tsx");
    expect(filePaths).toContain("src/styles/main.css");
    expect(filePaths).toContain("config/settings.json");
  });
});

describe("resolveModuleNames", () => {
  it("resolves PascalCase module name to matching file", () => {
    const zones = makeZoneIndex({
      "zone-a": ["src/blast-radius.ts", "src/conflict-graph.ts"],
    });

    const resolved = resolveModuleNames(new Set(["BlastRadius"]), zones);

    expect(resolved).toContain("src/blast-radius.ts");
    expect(resolved).not.toContain("src/conflict-graph.ts");
  });

  it("resolves exact basename match (case-insensitive)", () => {
    const zones = makeZoneIndex({
      "zone-a": ["src/RequestDedup.ts"],
    });

    const resolved = resolveModuleNames(new Set(["RequestDedup"]), zones);

    expect(resolved).toContain("src/RequestDedup.ts");
  });

  it("returns empty set for unresolvable module names", () => {
    const zones = makeZoneIndex({
      "zone-a": ["src/foo.ts", "src/bar.ts"],
    });

    const resolved = resolveModuleNames(new Set(["NonExistentModule"]), zones);

    expect(resolved.size).toBe(0);
  });

  it("returns empty set for empty module names", () => {
    const zones = makeZoneIndex({ "zone-a": ["src/foo.ts"] });

    const resolved = resolveModuleNames(new Set(), zones);

    expect(resolved.size).toBe(0);
  });

  it("resolves across multiple zones", () => {
    const zones = makeZoneIndex({
      "zone-a": ["src/my-component.ts"],
      "zone-b": ["src/my-service.ts"],
    });

    const resolved = resolveModuleNames(
      new Set(["MyComponent", "MyService"]),
      zones,
    );

    expect(resolved).toContain("src/my-component.ts");
    expect(resolved).toContain("src/my-service.ts");
  });
});

// ── Signal 3: Import neighbor expansion ─────────────────────────────────────

describe("expandImportNeighbors", () => {
  it("adds files that are imported by blast radius files", () => {
    const imports = makeImportGraph({
      "src/a.ts": ["src/b.ts", "src/c.ts"],
    });

    const result = expandImportNeighbors(new Set(["src/a.ts"]), imports);

    expect(result).toContain("src/a.ts");
    expect(result).toContain("src/b.ts");
    expect(result).toContain("src/c.ts");
  });

  it("adds files that import blast radius files (reverse edges)", () => {
    const imports = makeImportGraph({
      "src/consumer.ts": ["src/target.ts"],
    });

    const result = expandImportNeighbors(new Set(["src/consumer.ts"]), imports);

    // consumer.ts is in the graph, so its neighbors are added
    expect(result).toContain("src/consumer.ts");
    expect(result).toContain("src/target.ts");
  });

  it("does not expand beyond 1 hop", () => {
    const imports = makeImportGraph({
      "src/a.ts": ["src/b.ts"],
      "src/b.ts": ["src/c.ts"],
      "src/c.ts": ["src/d.ts"],
    });

    const result = expandImportNeighbors(new Set(["src/a.ts"]), imports);

    expect(result).toContain("src/a.ts");
    expect(result).toContain("src/b.ts");
    expect(result).not.toContain("src/c.ts");
    expect(result).not.toContain("src/d.ts");
  });

  it("handles files with no import edges", () => {
    const imports = makeImportGraph({});

    const result = expandImportNeighbors(new Set(["src/isolated.ts"]), imports);

    expect(result).toEqual(new Set(["src/isolated.ts"]));
  });

  it("handles empty input file set", () => {
    const imports = makeImportGraph({
      "src/a.ts": ["src/b.ts"],
    });

    const result = expandImportNeighbors(new Set(), imports);

    expect(result.size).toBe(0);
  });
});

// ── Signal 4: Sibling heuristic ─────────────────────────────────────────────

describe("blastRadius — sibling heuristic", () => {
  it("unions blast radii of sibling tasks under the same feature", () => {
    const task1 = makeTask({
      id: "t1",
      tags: ["zone-a"],
    });
    const task2 = makeTask({
      id: "t2",
      tags: ["zone-b"],
    });
    const feature = makeFeature("f1", [task1, task2]);

    const zones = makeZoneIndex({
      "zone-a": ["src/a.ts"],
      "zone-b": ["src/b.ts"],
    });
    const imports = makeImportGraph({});

    const result = blastRadius([feature], zones, imports);

    // Both tasks should contain the union of both zones' files
    expect(result.get("t1")).toContain("src/a.ts");
    expect(result.get("t1")).toContain("src/b.ts");
    expect(result.get("t2")).toContain("src/a.ts");
    expect(result.get("t2")).toContain("src/b.ts");
  });

  it("does not merge blast radii across different features", () => {
    const task1 = makeTask({ id: "t1", tags: ["zone-a"] });
    const task2 = makeTask({ id: "t2", tags: ["zone-b"] });
    const feature1 = makeFeature("f1", [task1]);
    const feature2 = makeFeature("f2", [task2]);

    const zones = makeZoneIndex({
      "zone-a": ["src/a.ts"],
      "zone-b": ["src/b.ts"],
    });
    const imports = makeImportGraph({});

    const result = blastRadius([feature1, feature2], zones, imports);

    // Task 1 only has zone-a files, task 2 only has zone-b files
    expect(result.get("t1")).toContain("src/a.ts");
    expect(result.get("t1")).not.toContain("src/b.ts");
    expect(result.get("t2")).toContain("src/b.ts");
    expect(result.get("t2")).not.toContain("src/a.ts");
  });
});

// ── Main blastRadius function ───────────────────────────────────────────────

describe("blastRadius", () => {
  it("returns a Map with entries for all tasks", () => {
    const task1 = makeTask({ id: "t1" });
    const task2 = makeTask({ id: "t2" });
    const feature = makeFeature("f1", [task1, task2]);

    const result = blastRadius([feature], new Map(), new Map());

    expect(result.has("t1")).toBe(true);
    expect(result.has("t2")).toBe(true);
  });

  it("returns empty blast radius for tasks with no tags or criteria", () => {
    const task = makeTask({ id: "t1", tags: undefined, acceptanceCriteria: undefined });
    const feature = makeFeature("f1", [task]);

    const result = blastRadius([feature], new Map(), new Map());

    expect(result.get("t1")!.size).toBe(0);
  });

  it("handles tasks with empty tags and criteria", () => {
    const task = makeTask({ id: "t1", tags: [], acceptanceCriteria: [] });
    const feature = makeFeature("f1", [task]);

    const result = blastRadius([feature], new Map(), new Map());

    expect(result.get("t1")!.size).toBe(0);
  });

  it("combines zone expansion with acceptance criteria extraction", () => {
    const task = makeTask({
      id: "t1",
      tags: ["web-viewer"],
      acceptanceCriteria: ["Update src/utils/helper.ts to support the new format"],
    });
    const feature = makeFeature("f1", [task]);

    const zones = makeZoneIndex({
      "web-viewer": ["src/viewer/app.tsx", "src/viewer/index.ts"],
    });
    const imports = makeImportGraph({});

    const result = blastRadius([feature], zones, imports);
    const radius = result.get("t1")!;

    // Zone files
    expect(radius).toContain("src/viewer/app.tsx");
    expect(radius).toContain("src/viewer/index.ts");
    // Criteria file
    expect(radius).toContain("src/utils/helper.ts");
  });

  it("applies import expansion to seed files from zones and criteria", () => {
    const task = makeTask({
      id: "t1",
      tags: ["zone-a"],
    });
    const feature = makeFeature("f1", [task]);

    const zones = makeZoneIndex({
      "zone-a": ["src/a.ts"],
    });
    const imports = makeImportGraph({
      "src/a.ts": ["src/shared/utils.ts"],
    });

    const result = blastRadius([feature], zones, imports);
    const radius = result.get("t1")!;

    // Original zone file
    expect(radius).toContain("src/a.ts");
    // 1-hop import neighbor
    expect(radius).toContain("src/shared/utils.ts");
  });

  it("handles subtasks within tasks", () => {
    const subtask = makeTask({
      id: "st1",
      level: "subtask",
      tags: ["zone-a"],
    });
    const task = makeTask({
      id: "t1",
      children: [subtask],
    });
    const feature = makeFeature("f1", [task]);

    const zones = makeZoneIndex({
      "zone-a": ["src/a.ts"],
    });
    const imports = makeImportGraph({});

    const result = blastRadius([feature], zones, imports);

    // Subtask should have its own blast radius
    expect(result.has("st1")).toBe(true);
    expect(result.get("st1")).toContain("src/a.ts");
  });

  it("processes deeply nested task trees", () => {
    const task = makeTask({ id: "t1", tags: ["zone-a"] });
    const feature = makeFeature("f1", [task]);
    const epic: PRDItem = {
      id: "e1",
      title: "Epic 1",
      status: "pending",
      level: "epic",
      children: [feature],
    };

    const zones = makeZoneIndex({
      "zone-a": ["src/a.ts"],
    });
    const imports = makeImportGraph({});

    const result = blastRadius([epic], zones, imports);

    expect(result.has("t1")).toBe(true);
    expect(result.get("t1")).toContain("src/a.ts");
  });

  it("does not include epics or features in the result map", () => {
    const task = makeTask({ id: "t1" });
    const feature = makeFeature("f1", [task]);
    const epic: PRDItem = {
      id: "e1",
      title: "Epic 1",
      status: "pending",
      level: "epic",
      children: [feature],
    };

    const result = blastRadius([epic], new Map(), new Map());

    expect(result.has("e1")).toBe(false);
    expect(result.has("f1")).toBe(false);
    expect(result.has("t1")).toBe(true);
  });

  it("combines all four signal sources end-to-end", () => {
    // Task with zone tag, acceptance criteria with file paths and module names,
    // and import neighbors
    const task1 = makeTask({
      id: "t1",
      tags: ["zone-a"],
      acceptanceCriteria: [
        "Update `src/config/settings.ts` to add new field",
        "Ensure MyHelper class works correctly",
      ],
    });
    const task2 = makeTask({
      id: "t2",
      tags: ["zone-b"],
      acceptanceCriteria: [
        "Add validation in src/validators/input.ts",
      ],
    });
    const feature = makeFeature("f1", [task1, task2]);

    const zones = makeZoneIndex({
      "zone-a": ["src/a.ts", "src/my-helper.ts"],
      "zone-b": ["src/b.ts"],
    });
    const imports = makeImportGraph({
      "src/a.ts": ["src/shared/types.ts"],
      "src/b.ts": ["src/shared/utils.ts"],
    });

    const result = blastRadius([feature], zones, imports);

    const r1 = result.get("t1")!;
    const r2 = result.get("t2")!;

    // Signal 1: zone files
    expect(r1).toContain("src/a.ts");
    expect(r1).toContain("src/my-helper.ts");

    // Signal 2: criteria file path
    expect(r1).toContain("src/config/settings.ts");

    // Signal 2: criteria module name resolved
    expect(r1).toContain("src/my-helper.ts");

    // Signal 3: import neighbor
    expect(r1).toContain("src/shared/types.ts");

    // Signal 4: sibling heuristic — t1 gets t2's files and vice versa
    expect(r1).toContain("src/b.ts");
    expect(r2).toContain("src/a.ts");

    // t2 should also have its own direct signals
    expect(r2).toContain("src/b.ts");
    expect(r2).toContain("src/validators/input.ts");
    expect(r2).toContain("src/shared/utils.ts");
  });
});
