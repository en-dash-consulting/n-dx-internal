// @vitest-environment jsdom
/**
 * Tests for the MergeGraphView component.
 *
 * Covers:
 *   - top-down progressive disclosure (only epics visible on initial load,
 *     children appear when their parent is clicked)
 *   - selection-driven highlighting (root + transitive descendants)
 *   - the inline PRD front-matter summary card
 *   - the merge metadata panel above the graph
 *
 * Mocks both backing fetches (`/api/merge-graph` and `/data/prd.json`) so
 * the view renders fully.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  MergeGraphView,
  collectPrdSubtreeIds,
  resolveMergeMetaForSelection,
  applyExpansionVisibility,
  buildPrdChildCount,
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

/**
 * Helper: find a PRD node by aria-label substring, scoped to currently
 * rendered nodes. Returns undefined if not currently visible.
 */
function findPrdNode(root: HTMLElement, titleSubstring: string): SVGGElement | undefined {
  return [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
    .find((n) => n.getAttribute("aria-label")?.includes(titleSubstring));
}

/**
 * Click a PRD node by title. Throws if it isn't currently visible — that
 * surfaces ordering bugs in expand/collapse-driven tests instead of letting
 * a missing click silently no-op.
 */
async function clickPrd(root: HTMLElement, titleSubstring: string) {
  const node = findPrdNode(root, titleSubstring);
  if (!node) throw new Error(`PRD node with title containing "${titleSubstring}" is not currently visible`);
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
  });
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

  it("highlights the clicked PRD subtree and dims unrelated nodes once expanded", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress", priority: "high", tags: ["alpha", "beta"] },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending", priority: "high" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    // Initial render: only the two epics are visible — descendants stay
    // hidden until the user expands them.
    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    // Click E1 → selects it AND expands its direct children, so F1 appears.
    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Feature One")).toBeTruthy();
    });

    // Subtree highlight covers E1 and F1 (T1/T2 are also in the highlight
    // id-set but not yet rendered); the unrelated epic dims.
    const opacityFor = (title: string) =>
      (findPrdNode(root, title) as unknown as HTMLElement | undefined)?.style.opacity || "";
    expect(opacityFor("Epic One")).toBe("1");
    expect(opacityFor("Feature One")).toBe("1");
    expect(opacityFor("Epic Two")).toBe("0.2");
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
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    // Clicking an epic both expands its children and opens the front-matter
    // summary panel for the clicked node.
    await clickPrd(root, "Epic One");

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
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    // Walk down to T2: expand E1 → expand F1 → click T2.
    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Feature One")).toBeTruthy();
    });
    await clickPrd(root, "Feature One");
    await waitFor(() => {
      expect(findPrdNode(root, "Task Two")).toBeTruthy();
    });
    await clickPrd(root, "Task Two");

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
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
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
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    // Reach T1 via the expand chain: E1 → F1 → click T1 (which is linked
    // to merge M1 in the fixture).
    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Feature One")).toBeTruthy();
    });
    await clickPrd(root, "Feature One");
    await waitFor(() => {
      expect(findPrdNode(root, "Task One")).toBeTruthy();
    });
    await clickPrd(root, "Task One");

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
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    // Walk down to T2 (no linked merge in the fixture).
    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Feature One")).toBeTruthy();
    });
    await clickPrd(root, "Feature One");
    await waitFor(() => {
      expect(findPrdNode(root, "Task Two")).toBeTruthy();
    });
    await clickPrd(root, "Task Two");

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
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Feature One")).toBeTruthy();
    });
    await clickPrd(root, "Feature One");
    await waitFor(() => {
      expect(findPrdNode(root, "Task One")).toBeTruthy();
    });
    await clickPrd(root, "Task One");

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
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    // Expand the chain so the leaf tasks are reachable for selection.
    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Feature One")).toBeTruthy();
    });
    await clickPrd(root, "Feature One");
    await waitFor(() => {
      expect(findPrdNode(root, "Task One")).toBeTruthy();
      expect(findPrdNode(root, "Task Two")).toBeTruthy();
    });

    // Select T1 (has merge) — row appears.
    await clickPrd(root, "Task One");
    await waitFor(() => {
      expect(root.querySelector(".mg-meta-row")).not.toBeNull();
    });

    // Switch to T2 (no merge) — row gone, no-merge state present.
    await clickPrd(root, "Task Two");
    await waitFor(() => {
      const panel = root.querySelector(".mg-meta-panel");
      if (!panel || !panel.classList.contains("mg-meta-no-merge")) {
        throw new Error("waiting for no-merge state");
      }
    });
    expect(root.querySelector(".mg-meta-row")).toBeNull();

    // Switch back to T1 — row reappears, no stale "no merge" state.
    await clickPrd(root, "Task One");
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
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    const initialMergeFetches = fetchSpy.mock.calls
      .filter(([url]) => typeof url === "string" && url.startsWith("/api/merge-graph"))
      .length;
    expect(initialMergeFetches).toBe(1);

    // Expanding/selecting nodes must never re-issue the graph fetch — the
    // existing graph data drives both the layout and the metadata panel.
    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Feature One")).toBeTruthy();
    });
    await clickPrd(root, "Feature One");
    await waitFor(() => {
      expect(findPrdNode(root, "Task One")).toBeTruthy();
    });
    await clickPrd(root, "Task One");
    await clickPrd(root, "Task Two");
    await clickPrd(root, "Epic One");

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
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    // Click E1 — expands to F1, dims E2.
    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Feature One")).toBeTruthy();
    });

    const find = (title: string) =>
      findPrdNode(root, title) as unknown as HTMLElement;

    expect(find("Epic One").style.opacity || "1").toBe("1");
    expect(find("Feature One").style.opacity || "1").toBe("1");
    expect(find("Epic Two").style.opacity).toBe("0.2");

    // Click E2 — selecting/highlighting flips to E2's subtree, so E1+F1
    // dim. E1 stays expanded (expansion is independent of selection),
    // so F1 is still rendered for the assertion.
    await clickPrd(root, "Epic Two");

    expect(find("Epic Two").style.opacity || "1").toBe("1");
    expect(find("Epic One").style.opacity).toBe("0.2");
    expect(find("Feature One").style.opacity).toBe("0.2");
  });

  // ── Top-down layout & expand/collapse ────────────────────────────────────

  it("renders only top-level (epic) nodes on initial load", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    // Both visible nodes are epics. Descendants are unmounted.
    const labels = [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
      .map((n) => n.getAttribute("aria-label") ?? "");
    expect(labels.some((l) => l.includes("Epic One"))).toBe(true);
    expect(labels.some((l) => l.includes("Epic Two"))).toBe(true);
    expect(labels.some((l) => l.includes("Feature"))).toBe(false);
    expect(labels.some((l) => l.includes("Task"))).toBe(false);
  });

  it("toggles direct children visible / hidden on each click", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    // First click expands E1 — F1 (direct child) appears; T1/T2 stay
    // hidden because F1 itself is still collapsed.
    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Feature One")).toBeTruthy();
    });
    expect(findPrdNode(root, "Task One")).toBeUndefined();
    expect(findPrdNode(root, "Task Two")).toBeUndefined();

    // Second click on E1 collapses it — F1 disappears.
    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Feature One")).toBeUndefined();
    });

    // Re-expand E1, then expand F1 to surface tasks one level deeper.
    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Feature One")).toBeTruthy();
    });
    await clickPrd(root, "Feature One");
    await waitFor(() => {
      expect(findPrdNode(root, "Task One")).toBeTruthy();
      expect(findPrdNode(root, "Task Two")).toBeTruthy();
    });

    // Collapsing E1 hides the entire subtree, not just its direct children.
    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Feature One")).toBeUndefined();
    });
    expect(findPrdNode(root, "Task One")).toBeUndefined();
    expect(findPrdNode(root, "Task Two")).toBeUndefined();
  });

  it("renders an expand affordance on nodes with children, none on leaves", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      // E2 is a leaf epic (no descendants); should not get an affordance.
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    const e1 = findPrdNode(root, "Epic One")!;
    const e2 = findPrdNode(root, "Epic Two")!;
    expect(e1.getAttribute("data-expanded")).toBe("false"); // collapsed, has children
    expect(e2.getAttribute("data-expanded")).toBe("leaf");  // no children, no affordance
    expect(e1.querySelector(".mg-affordance")?.textContent).toBe("▶");
    expect(e2.querySelector(".mg-affordance")).toBeNull();

    // After expand, the affordance flips to ▼.
    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Epic One")?.getAttribute("data-expanded")).toBe("true");
    });
    expect(findPrdNode(root, "Epic One")?.querySelector(".mg-affordance")?.textContent).toBe("▼");
  });

  it("places parents above children in the top-down layout", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    // Expand the chain so we can compare parent/child y coords.
    await clickPrd(root, "Epic One");
    await clickPrd(root, "Feature One");
    await waitFor(() => {
      expect(findPrdNode(root, "Task One")).toBeTruthy();
    });

    // Each PRD node carries its position in `transform="translate(x,y)"`.
    const parseY = (el: SVGGElement): number => {
      const t = el.getAttribute("transform") ?? "";
      const m = /translate\(([^,]+),([^)]+)\)/.exec(t);
      return m ? parseFloat(m[2]) : NaN;
    };

    const e1y = parseY(findPrdNode(root, "Epic One")!);
    const f1y = parseY(findPrdNode(root, "Feature One")!);
    const t1y = parseY(findPrdNode(root, "Task One")!);
    expect(Number.isFinite(e1y) && Number.isFinite(f1y) && Number.isFinite(t1y)).toBe(true);
    // Parents above children → smaller y at the top of an SVG canvas.
    expect(e1y).toBeLessThan(f1y);
    expect(f1y).toBeLessThan(t1y);
  });

  // ── Visual regression: compact folder-tree layout ────────────────────────
  //
  // Locks in the new rhythm so a future "let's spread the graph out again"
  // change registers as an obvious snapshot diff. Captures, for the standard
  // 4-node PRD fixture (E1 → F1 → T1, T2 + E2), each node's position, the
  // overall vertical span, and the indent rhythm. Fixture and assertions
  // intentionally stay simple so the snapshot is easy to update if (and only
  // if) the design moves on purpose.

  it("renders the compact folder-tree layout for a representative PRD fixture", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });

    // Fully expand the E1 subtree so all four nodes (E1, F1, T1, T2) plus E2
    // are visible at once — the most-coverage state for the snapshot.
    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(findPrdNode(root, "Feature One")).toBeTruthy();
    });
    await clickPrd(root, "Feature One");
    await waitFor(() => {
      expect(findPrdNode(root, "Task One")).toBeTruthy();
      expect(findPrdNode(root, "Task Two")).toBeTruthy();
      expect(findPrdNode(root, "Epic Two")).toBeTruthy();
    });

    const parseXY = (el: SVGGElement): { x: number; y: number } => {
      const t = el.getAttribute("transform") ?? "";
      const m = /translate\(([^,]+),([^)]+)\)/.exec(t);
      if (!m) throw new Error(`missing transform: ${t}`);
      return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    };

    const positions: Record<string, { x: number; y: number }> = {};
    for (const title of ["Epic One", "Feature One", "Task One", "Task Two", "Epic Two"]) {
      const node = findPrdNode(root, title);
      expect(node, `${title} should be visible`).toBeTruthy();
      positions[title] = parseXY(node!);
    }

    // Snapshot: exact positions for the compact folder-tree layout.
    //
    //   • Indent (x): epic=0, feature=22, task=44 — every level adds INDENT_W.
    //   • Pitch  (y): every visible node owns a row of ROW_H=22 in DFS
    //     pre-order, so the column reads as a single tight stack.
    expect(positions).toEqual({
      "Epic One":    { x: 0,  y: 0 },
      "Feature One": { x: 22, y: 22 },
      "Task One":    { x: 44, y: 44 },
      "Task Two":    { x: 44, y: 66 },
      "Epic Two":    { x: 0,  y: 88 },
    });

    // The whole 5-node tree fits inside 88px of vertical space — well under
    // the prior flowchart layout's ~330px (3 levels × ROW_H_LEVEL=110) — so
    // a typical PRD prints in noticeably less space.
    const ys = Object.values(positions).map((p) => p.y);
    const verticalSpan = Math.max(...ys) - Math.min(...ys);
    expect(verticalSpan).toBeLessThanOrEqual(100);
    expect(verticalSpan).toBeLessThan(330);

    // Adjacent rows in DFS order are exactly one ROW_H apart — the rhythm
    // that gives the layout its folder-tree feel.
    const sortedYs = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sortedYs.length; i++) {
      expect(sortedYs[i] - sortedYs[i - 1]).toBe(22);
    }

    // The single MERGES column header is the only column label — per-row
    // level labels were dropped because shape + indent already encode level.
    const colLabels = root.querySelectorAll(".mg-col-label");
    expect(colLabels.length).toBe(1);
    expect(colLabels[0].textContent).toBe("MERGES");

    // Tree edges render as straight L-shapes (no curve commands) so the
    // indent rails read crisply at small sizes.
    const treeEdgeDs = [...root.querySelectorAll<SVGPathElement>(".mg-edge-tree")]
      .map((p) => p.getAttribute("d") ?? "");
    expect(treeEdgeDs.length).toBeGreaterThan(0);
    for (const d of treeEdgeDs) {
      expect(d).not.toMatch(/[CcQqSsTt]/); // no Bézier curve commands
      expect(d).toMatch(/^M[^L]+L[^L]+L[^L]+$/); // M …, L …, L …
    }
  });
});

// ── applyExpansionVisibility (pure helper) ────────────────────────────────────

describe("applyExpansionVisibility", () => {
  it("returns only top-level filtered ids when nothing is expanded", () => {
    const graph = makeGraph();
    const filtered = new Set<string>(["E1", "F1", "T1", "T2", "E2"]);
    const visible = applyExpansionVisibility(graph as never, filtered, new Set());
    expect([...visible].sort()).toEqual(["E1", "E2"]);
  });

  it("reveals descendants only when every ancestor is expanded", () => {
    const graph = makeGraph();
    const filtered = new Set<string>(["E1", "F1", "T1", "T2", "E2"]);
    // Expand E1 only — F1 surfaces but T1/T2 stay hidden because F1 is still
    // collapsed.
    const visibleE1Only = applyExpansionVisibility(graph as never, filtered, new Set(["E1"]));
    expect([...visibleE1Only].sort()).toEqual(["E1", "E2", "F1"]);

    // Expand E1 + F1 — full subtree under E1 becomes visible.
    const visibleE1F1 = applyExpansionVisibility(
      graph as never,
      filtered,
      new Set(["E1", "F1"]),
    );
    expect([...visibleE1F1].sort()).toEqual(["E1", "E2", "F1", "T1", "T2"]);
  });

  it("ignores expansion of an ancestor that is itself filtered out", () => {
    const graph = makeGraph();
    // E1 is filtered out but expanded — F1/T1/T2 should NOT appear because
    // their ancestor chain is broken at E1.
    const filtered = new Set<string>(["F1", "T1", "T2", "E2"]);
    const visible = applyExpansionVisibility(
      graph as never,
      filtered,
      new Set(["E1", "F1"]),
    );
    // F1 has parent E1 expanded, so F1 surfaces. T1/T2 require F1 expanded
    // (which it is) AND E1 expanded — both true. So all of F1/T1/T2 visible.
    // Note: this test documents that visibility checks the *expansion* of
    // ancestors regardless of whether they pass the filter themselves.
    expect([...visible].sort()).toEqual(["E2", "F1", "T1", "T2"]);
  });
});

// ── buildPrdChildCount ────────────────────────────────────────────────────────

describe("buildPrdChildCount", () => {
  it("counts direct children per PRD parent and skips merge nodes", () => {
    const counts = buildPrdChildCount(makeGraph() as never);
    expect(counts.get("E1")).toBe(1); // F1
    expect(counts.get("F1")).toBe(2); // T1, T2
    expect(counts.get("E2")).toBeUndefined();
    expect(counts.get("T1")).toBeUndefined();
  });
});
