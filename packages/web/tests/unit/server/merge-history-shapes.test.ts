/**
 * Unit tests for shape classification and folder-tree path derivation in
 * merge-history.ts.
 *
 * `classifyNodeShape` is now a pure function over the parsed PRD tree — it no
 * longer reads `.rex/prd_tree/` directly. The folder-tree parser
 * (`parseFolderTree` in rex) is the single source of truth for the hierarchy;
 * this layer just consumes its output. These tests therefore drive the shape
 * classifier and `flattenPrdItems` from in-memory `PRDDocument` fixtures.
 */

import { describe, it, expect } from "vitest";
import { classifyNodeShape, flattenPrdItems } from "../../../src/server/merge-history.js";
import type { PRDDocument, PRDItem } from "../../../src/server/rex-gateway.js";

// ── classifyNodeShape (pure, in-memory) ──────────────────────────────────────

function leaf(id: string, level: PRDItem["level"] = "task"): PRDItem {
  return { id, title: id, level, status: "pending" };
}

function parent(id: string, level: PRDItem["level"], children: PRDItem[]): PRDItem {
  return { id, title: id, level, status: "pending", children };
}

describe("classifyNodeShape (pure)", () => {
  it("classifies an item with no children as triangle", () => {
    expect(classifyNodeShape(leaf("t1"))).toBe("triangle");
  });

  it("classifies an item whose children are all leaves as diamond", () => {
    const task = parent("t1", "task", [leaf("s1", "subtask"), leaf("s2", "subtask")]);
    expect(classifyNodeShape(task)).toBe("diamond");
  });

  it("classifies an item whose children all have grandchildren as trapezoid", () => {
    const epic = parent("e1", "epic", [
      parent("f1", "feature", [leaf("t1")]),
      parent("f2", "feature", [leaf("t2")]),
    ]);
    expect(classifyNodeShape(epic)).toBe("trapezoid");
  });

  it("classifies a parent with mixed leaf + folder children as diamond", () => {
    const feature = parent("f1", "feature", [
      leaf("t1"),                                // leaf — stored as `<slug>.md`
      parent("t2", "task", [leaf("s1", "subtask")]), // folder — stored as `<slug>/index.md`
    ]);
    expect(classifyNodeShape(feature)).toBe("diamond");
  });

  it("does not require disk access (no I/O regression)", () => {
    // No path argument exists — the function is pure.
    expect(classifyNodeShape.length).toBe(1);
  });
});

// ── flattenPrdItems: folder-tree-driven ordering and treePath ────────────────

describe("flattenPrdItems folder-tree ordering", () => {
  function fixture(): PRDDocument {
    return {
      schema: "rex/v1",
      title: "Test PRD",
      items: [
        parent("e1", "epic", [
          parent("f1", "feature", [leaf("t1"), leaf("t2")]),
        ]),
        leaf("e2", "epic"),
      ],
    };
  }

  it("emits nodes in DFS pre-order matching the folder-tree view", () => {
    const { nodes } = flattenPrdItems(fixture());
    // DFS pre-order: e1 → f1 → t1 → t2 → e2 (the same order the dashboard's
    // PRD tree view renders rows).
    expect(nodes.map((n) => n.id)).toEqual(["e1", "f1", "t1", "t2", "e2"]);
  });

  it("attaches a treePath whose segments mirror the on-disk slug chain", () => {
    const { nodes } = flattenPrdItems(fixture());
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // Each level appends one segment — the path is the slug chain, identical
    // to the relative path under `.rex/prd_tree/`.
    expect(byId.get("e1")?.treePath).toBe("e1");
    expect(byId.get("f1")?.treePath).toBe("e1/f1");
    expect(byId.get("t1")?.treePath).toBe("e1/f1/t1");
    expect(byId.get("t2")?.treePath).toBe("e1/f1/t2");
    expect(byId.get("e2")?.treePath).toBe("e2");
  });

  it("derives shape from in-memory tree structure (no rexDir needed)", () => {
    const { nodes } = flattenPrdItems(fixture());
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // e1 → only folder-children (f1) → trapezoid
    expect(byId.get("e1")?.shape).toBe("trapezoid");
    // f1 → only leaf-children (t1, t2) → diamond
    expect(byId.get("f1")?.shape).toBe("diamond");
    // leaves → triangle
    expect(byId.get("t1")?.shape).toBe("triangle");
    expect(byId.get("t2")?.shape).toBe("triangle");
    expect(byId.get("e2")?.shape).toBe("triangle");
  });

  it("preserves parent relationships built from folder-tree containment", () => {
    const { nodes } = flattenPrdItems(fixture());
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get("e1")?.parentId).toBeUndefined();
    expect(byId.get("f1")?.parentId).toBe("e1");
    expect(byId.get("t1")?.parentId).toBe("f1");
    expect(byId.get("t2")?.parentId).toBe("f1");
    expect(byId.get("e2")?.parentId).toBeUndefined();
  });

  it("uses the canonical resolveSiblingSlugs helper for treePath segments", () => {
    // Two siblings with the same title get distinct slugs via short-id suffix
    // — the same rule the on-disk serializer uses, so the graph and the
    // filesystem stay in lockstep without re-walking the directory.
    const doc: PRDDocument = {
      schema: "rex/v1",
      title: "Collision PRD",
      items: [
        {
          id: "0123456789ab-1111-2222-3333-444444444444",
          title: "Same Title",
          level: "epic",
          status: "pending",
        },
        {
          id: "fedcba987654-1111-2222-3333-444444444444",
          title: "Same Title",
          level: "epic",
          status: "pending",
        },
      ],
    };
    const { nodes } = flattenPrdItems(doc);
    const treePaths = nodes.map((n) => n.treePath);
    // Both paths start with the title slug, but diverge at the short-id
    // suffix segment so each is unique.
    expect(new Set(treePaths).size).toBe(treePaths.length);
    for (const p of treePaths) {
      expect(p?.startsWith("same-title")).toBe(true);
    }
  });
});
