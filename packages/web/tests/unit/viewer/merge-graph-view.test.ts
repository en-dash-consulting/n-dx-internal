// @vitest-environment jsdom
/**
 * Tests for the MergeGraphView component.
 *
 * Covers selection-driven highlighting (root + transitive descendants) and
 * the inline PRD front-matter summary card. Mocks both backing fetches
 * (`/api/merge-graph` and `/data/prd.json`) so the view renders fully.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  MergeGraphView,
  collectPrdSubtreeIds,
  resolveMergeMetaForSelection,
} from "../../../src/viewer/views/merge-graph.js";

// ── Fixture helpers ───────────────────────────────────────────────────────────

interface MinimalPrdNode {
  kind: "prd";
  id: string;
  title: string;
  level: string;
  status: string;
  parentId?: string;
  priority?: string;
  shape?: string;
}

interface MinimalMergeNode {
  kind: "merge";
  id: string;
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  mergedAt: string;
  author: string;
  parents: string[];
  filesSummary: {
    added: number;
    modified: number;
    deleted: number;
    renamed: number;
    copied: number;
    other: number;
    total: number;
  };
  files: Array<{ status: string; path: string }>;
}

interface MinimalGraph {
  generatedAt: string;
  nodes: Array<MinimalPrdNode | MinimalMergeNode>;
  edges: Array<{ from: string; to: string; attribution: string }>;
  stats: {
    merges: number;
    mergesWithPrdLinkage: number;
    mergesWithoutPrdLinkage: number;
    prdItemsLinked: number;
  };
}

function emptyFilesSummary() {
  return {
    added: 0, modified: 0, deleted: 0, renamed: 0, copied: 0, other: 0, total: 0,
  };
}

/**
 * Build a 4-node PRD subtree with one branching feature so descendant logic
 * can be exercised: epic E1 → feature F1 → task T1 + task T2; epic E2 is
 * unrelated.
 */
function makeGraph(): MinimalGraph {
  return {
    generatedAt: "2026-05-08T00:00:00Z",
    nodes: [
      { kind: "prd", id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { kind: "prd", id: "F1", title: "Feature One", level: "feature", status: "pending", parentId: "E1" },
      { kind: "prd", id: "T1", title: "Task One", level: "task", status: "pending", parentId: "F1", priority: "high" },
      { kind: "prd", id: "T2", title: "Task Two", level: "task", status: "pending", parentId: "F1" },
      { kind: "prd", id: "E2", title: "Epic Two", level: "epic", status: "pending" },
      {
        kind: "merge", id: "M1", sha: "abcdef1", shortSha: "abcdef1",
        subject: "fix: thing", body: "", mergedAt: "2026-05-01T00:00:00Z",
        author: "alice", parents: [],
        filesSummary: emptyFilesSummary(), files: [],
      },
    ],
    edges: [
      { from: "M1", to: "T1", attribution: "commit-message" },
    ],
    stats: { merges: 1, mergesWithPrdLinkage: 1, mergesWithoutPrdLinkage: 0, prdItemsLinked: 1 },
  };
}

async function flush() {
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

async function waitFor(fn: () => void, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      fn();
      return;
    } catch {
      await new Promise<void>((r) => setTimeout(r, 10));
    }
  }
  fn();
}

// ── collectPrdSubtreeIds ──────────────────────────────────────────────────────

describe("collectPrdSubtreeIds", () => {
  it("returns the root and every transitive descendant", () => {
    const subtree = collectPrdSubtreeIds(makeGraph() as never, "E1");
    expect([...subtree].sort()).toEqual(["E1", "F1", "T1", "T2"]);
  });

  it("returns just the root for a leaf node", () => {
    const subtree = collectPrdSubtreeIds(makeGraph() as never, "T1");
    expect([...subtree]).toEqual(["T1"]);
  });

  it("excludes unrelated PRD branches", () => {
    const subtree = collectPrdSubtreeIds(makeGraph() as never, "E2");
    expect([...subtree]).toEqual(["E2"]);
  });
});

// ── resolveMergeMetaForSelection ─────────────────────────────────────────────

describe("resolveMergeMetaForSelection", () => {
  it("returns [] for null graph or null selection", () => {
    expect(resolveMergeMetaForSelection(null, null)).toEqual([]);
    expect(
      resolveMergeMetaForSelection(makeGraph() as never, null),
    ).toEqual([]);
  });

  it("returns the merge node directly when a merge is selected", () => {
    const graph = makeGraph();
    const merge = graph.nodes.find((n) => n.kind === "merge")!;
    const result = resolveMergeMetaForSelection(
      graph as never,
      { kind: "merge", node: merge as never } as never,
    );
    expect(result.map((m) => m.id)).toEqual(["M1"]);
  });

  it("returns [] for a PRD selection with no linked merges", () => {
    const result = resolveMergeMetaForSelection(
      makeGraph() as never,
      {
        kind: "prd",
        node: { id: "T2", title: "Task Two", level: "task", status: "pending" },
        linkedMergeIds: [],
      } as never,
    );
    expect(result).toEqual([]);
  });

  it("resolves linked merges for a PRD selection, sorted by mergedAt desc", () => {
    const graph: MinimalGraph = {
      ...makeGraph(),
    };
    graph.nodes = [
      ...graph.nodes,
      {
        kind: "merge", id: "M2", sha: "deadbee", shortSha: "deadbee",
        subject: "later", body: "", mergedAt: "2026-05-03T00:00:00Z",
        author: "bob", parents: [],
        filesSummary: emptyFilesSummary(), files: [],
      },
    ];
    const result = resolveMergeMetaForSelection(
      graph as never,
      {
        kind: "prd",
        node: { id: "T1", title: "Task One", level: "task", status: "pending" },
        linkedMergeIds: ["M1", "M2"],
      } as never,
    );
    expect(result.map((m) => m.id)).toEqual(["M2", "M1"]);
  });
});

// ── MergeGraphView (DOM) ─────────────────────────────────────────────────────

describe("MergeGraphView selection behaviour", () => {
  let root: HTMLDivElement;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
    vi.restoreAllMocks();
  });

  function mountWithPrd(items: Array<Record<string, unknown>>) {
    fetchSpy.mockImplementation((url: string) => {
      if (url.startsWith("/api/merge-graph")) {
        return Promise.resolve(new Response(JSON.stringify(makeGraph()), { status: 200 }));
      }
      if (url.startsWith("/data/prd.json")) {
        return Promise.resolve(new Response(JSON.stringify({ items }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    act(() => {
      render(h(MergeGraphView, {}), root);
    });
  }

  it("highlights the clicked PRD node and dims unrelated PRD nodes", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress", priority: "high", tags: ["alpha", "beta"] },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending", priority: "high" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      const nodes = root.querySelectorAll(".mg-prd-node");
      expect(nodes.length).toBe(5);
    });

    const e1 = [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
      .find((n) => n.getAttribute("aria-label")?.includes("Epic One"));
    expect(e1).toBeTruthy();

    await act(async () => {
      e1!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    // Subtree (E1, F1, T1, T2) keeps full opacity; the unrelated epic dims.
    const opacities = new Map<string, string>();
    for (const node of root.querySelectorAll<SVGGElement>(".mg-prd-node")) {
      const label = node.getAttribute("aria-label") ?? "";
      const opacity = (node as unknown as HTMLElement).style.opacity || "1";
      if (label.includes("Epic One")) opacities.set("E1", opacity);
      else if (label.includes("Feature One")) opacities.set("F1", opacity);
      else if (label.includes("Task One")) opacities.set("T1", opacity);
      else if (label.includes("Task Two")) opacities.set("T2", opacity);
      else if (label.includes("Epic Two")) opacities.set("E2", opacity);
    }
    expect(opacities.get("E1")).toBe("1");
    expect(opacities.get("F1")).toBe("1");
    expect(opacities.get("T1")).toBe("1");
    expect(opacities.get("T2")).toBe("1");
    expect(opacities.get("E2")).toBe("0.2");
  });

  it("renders a front-matter summary with title, status, priority, and tags", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress", priority: "high", tags: ["alpha", "beta"] },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending", priority: "high", tags: ["graph"] },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    const e1 = [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
      .find((n) => n.getAttribute("aria-label")?.includes("Epic One"));
    await act(async () => {
      e1!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    await waitFor(() => {
      expect(root.querySelector(".mg-detail-prd")).not.toBeNull();
    });

    const panel = root.querySelector(".mg-detail-prd")!;
    expect(panel.querySelector(".mg-detail-subject")?.textContent).toBe("Epic One");
    expect(panel.querySelector(".mg-detail-title")?.textContent).toBe("EPIC");
    expect(panel.textContent).toContain("in progress");
    expect(panel.textContent).toContain("high");
    const tagEls = panel.querySelectorAll(".mg-frontmatter-tag");
    expect([...tagEls].map((t) => t.textContent)).toEqual(["alpha", "beta"]);
  });

  it("renders an em dash for missing priority/tags without breaking layout", async () => {
    mountWithPrd([
      // Intentionally omit priority and tags on T2.
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending", priority: "high" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    const t2 = [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
      .find((n) => n.getAttribute("aria-label")?.includes("Task Two"));
    await act(async () => {
      t2!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    await waitFor(() => {
      expect(root.querySelector(".mg-detail-prd")).not.toBeNull();
    });

    const panel = root.querySelector(".mg-detail-prd")!;
    const dds = [...panel.querySelectorAll<HTMLElement>("dd")];
    // Three rows: status, priority, tags.
    expect(dds.length).toBe(3);
    // Priority cell — em dash.
    expect(dds[1].textContent).toBe("—");
    // Tags cell — em dash via .mg-frontmatter-empty span.
    expect(dds[2].querySelector(".mg-frontmatter-empty")?.textContent).toBe("—");
    // No tag chips rendered.
    expect(panel.querySelectorAll(".mg-frontmatter-tag").length).toBe(0);
  });

  it("renders the empty/instructional merge metadata panel before any selection", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    const panel = root.querySelector(".mg-meta-panel");
    expect(panel).not.toBeNull();
    expect(panel!.classList.contains("mg-meta-empty")).toBe(true);
    expect(panel!.querySelector(".mg-meta-instruction")?.textContent ?? "")
      .toMatch(/select a node/i);
    // Empty state has no rows.
    expect(root.querySelector(".mg-meta-row")).toBeNull();
  });

  it("renders timestamp, short SHA, and author when a linked PRD node is selected", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    // T1 is linked to merge M1.
    const t1 = [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
      .find((n) => n.getAttribute("aria-label")?.includes("Task One"));
    await act(async () => {
      t1!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    await waitFor(() => {
      expect(root.querySelector(".mg-meta-row")).not.toBeNull();
    });

    const row = root.querySelector(".mg-meta-row")!;
    // Short SHA label.
    expect(row.querySelector(".mg-meta-sha-text")?.textContent).toBe("abcdef1");
    // Author.
    expect(row.querySelector(".mg-meta-author")?.textContent).toBe("alice");
    // Timestamp present (dateTime attribute carries the ISO source).
    expect(row.querySelector("time")?.getAttribute("datetime"))
      .toBe("2026-05-01T00:00:00Z");
    // Copy button carries the full hash for the affordance contract.
    expect(row.querySelector(".mg-meta-copy")?.getAttribute("data-full-sha"))
      .toBe("abcdef1");
  });

  it("shows 'no merge recorded' for a PRD node with no linked merges", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    // T2 has no linked merge in the fixture.
    const t2 = [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
      .find((n) => n.getAttribute("aria-label")?.includes("Task Two"));
    await act(async () => {
      t2!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    await waitFor(() => {
      const panel = root.querySelector(".mg-meta-panel");
      if (!panel || !panel.classList.contains("mg-meta-no-merge")) {
        throw new Error("waiting for no-merge state");
      }
    });

    const panel = root.querySelector(".mg-meta-panel")!;
    expect(panel.querySelector(".mg-meta-status")?.textContent).toBe("No merge recorded");
    expect(panel.querySelector(".mg-meta-context")?.textContent).toContain("Task Two");
    // No row content leaks through.
    expect(root.querySelector(".mg-meta-row")).toBeNull();
  });

  it("copies the full commit hash to the clipboard when the copy button is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    const t1 = [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
      .find((n) => n.getAttribute("aria-label")?.includes("Task One"));
    await act(async () => {
      t1!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    await waitFor(() => {
      expect(root.querySelector(".mg-meta-copy")).not.toBeNull();
    });

    const button = root.querySelector<HTMLButtonElement>(".mg-meta-copy")!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    // The fixture's full SHA equals the short SHA ("abcdef1") — the contract
    // is that whatever the merge node carries in `sha` is what gets written,
    // not the abbreviated label.
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("abcdef1");
  });

  it("updates the metadata panel synchronously when the selection changes", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    const find = (title: string) =>
      [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
        .find((n) => n.getAttribute("aria-label")?.includes(title))!;

    // Select T1 (has merge) — row appears.
    await act(async () => {
      find("Task One").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });
    await waitFor(() => {
      expect(root.querySelector(".mg-meta-row")).not.toBeNull();
    });

    // Switch to T2 (no merge) — row gone, no-merge state present.
    await act(async () => {
      find("Task Two").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });
    await waitFor(() => {
      const panel = root.querySelector(".mg-meta-panel");
      if (!panel || !panel.classList.contains("mg-meta-no-merge")) {
        throw new Error("waiting for no-merge state");
      }
    });
    expect(root.querySelector(".mg-meta-row")).toBeNull();

    // Switch back to T1 — row reappears, no stale "no merge" state.
    await act(async () => {
      find("Task One").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });
    await waitFor(() => {
      expect(root.querySelector(".mg-meta-row")).not.toBeNull();
    });
    expect(root.querySelector(".mg-meta-no-merge")).toBeNull();
  });

  it("does not refetch merge graph data when the selection changes", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    const initialMergeFetches = fetchSpy.mock.calls
      .filter(([url]) => typeof url === "string" && url.startsWith("/api/merge-graph"))
      .length;
    expect(initialMergeFetches).toBe(1);

    const find = (title: string) =>
      [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
        .find((n) => n.getAttribute("aria-label")?.includes(title))!;

    await act(async () => {
      find("Task One").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });
    await act(async () => {
      find("Task Two").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });
    await act(async () => {
      find("Epic One").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    const finalMergeFetches = fetchSpy.mock.calls
      .filter(([url]) => typeof url === "string" && url.startsWith("/api/merge-graph"))
      .length;
    expect(finalMergeFetches).toBe(1);
  });

  it("clears the previous highlight when a different node is selected", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    const find = (title: string) =>
      [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
        .find((n) => n.getAttribute("aria-label")?.includes(title))!;

    // Click E1 — F1/T1/T2 visible, E2 dimmed.
    await act(async () => {
      find("Epic One").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    let e2Opacity = (find("Epic Two") as unknown as HTMLElement).style.opacity;
    expect(e2Opacity).toBe("0.2");

    // Click E2 — now E1/F1/T1/T2 should be dimmed, only E2 stays bright.
    await act(async () => {
      find("Epic Two").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect((find("Epic Two") as unknown as HTMLElement).style.opacity).toBe("1");
    expect((find("Epic One") as unknown as HTMLElement).style.opacity).toBe("0.2");
    expect((find("Feature One") as unknown as HTMLElement).style.opacity).toBe("0.2");
    expect((find("Task One") as unknown as HTMLElement).style.opacity).toBe("0.2");
    expect((find("Task Two") as unknown as HTMLElement).style.opacity).toBe("0.2");
  });
});
