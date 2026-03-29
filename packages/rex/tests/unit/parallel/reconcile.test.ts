import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PRDDocument, PRDItem, ItemStatus } from "../../../src/schema/v1.js";
import type { PRDStore } from "../../../src/store/contracts.js";
import {
  detectChanges,
  applyChanges,
  reconcile,
} from "../../../src/parallel/reconcile.js";
import type {
  StatusChange,
  ReconcileSummary,
} from "../../../src/parallel/reconcile.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<PRDItem> = {}): PRDItem {
  return {
    id: "task-1",
    title: "Test Task",
    status: "pending",
    level: "task",
    ...overrides,
  };
}

function makeDoc(items: PRDItem[], title = "Test PRD"): PRDDocument {
  return { schema: "rex/v1", title, items };
}

function makeStore(doc: PRDDocument): PRDStore {
  const items = new Map<string, PRDItem>();
  const flattenItems = (list: PRDItem[]) => {
    for (const item of list) {
      items.set(item.id, item);
      if (item.children) flattenItems(item.children);
    }
  };
  flattenItems(doc.items);

  return {
    loadDocument: vi.fn().mockResolvedValue(doc),
    saveDocument: vi.fn().mockResolvedValue(undefined),
    getItem: vi.fn().mockImplementation(async (id: string) => items.get(id) ?? null),
    addItem: vi.fn().mockResolvedValue(undefined),
    updateItem: vi.fn().mockImplementation(async (id: string, updates: Partial<PRDItem>) => {
      const item = items.get(id);
      if (!item) throw new Error(`Item "${id}" not found`);
      Object.assign(item, updates);
    }),
    removeItem: vi.fn().mockResolvedValue(undefined),
    loadConfig: vi.fn().mockResolvedValue({ schema: "rex/v1", project: "test", adapter: "file" }),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    appendLog: vi.fn().mockResolvedValue(undefined),
    readLog: vi.fn().mockResolvedValue([]),
    loadWorkflow: vi.fn().mockResolvedValue(""),
    saveWorkflow: vi.fn().mockResolvedValue(undefined),
    withTransaction: vi.fn().mockImplementation(async (fn) => fn(doc)),
    capabilities: vi.fn().mockReturnValue({ adapter: "file", supportsTransactions: false, supportsWatch: false }),
  };
}

// ── detectChanges ───────────────────────────────────────────────────────────

describe("detectChanges", () => {
  it("detects a completed task in worktree", () => {
    const mainDoc = makeDoc([makeItem({ id: "t1", status: "in_progress" })]);
    const wtDoc = makeDoc([makeItem({ id: "t1", status: "completed" })]);

    const { changes, skipped, totalExamined } = detectChanges(mainDoc, wtDoc);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual(expect.objectContaining({
      id: "t1",
      mainStatus: "in_progress",
      worktreeStatus: "completed",
    }));
    expect(skipped).toBe(0);
    expect(totalExamined).toBe(1);
  });

  it("detects a failing task in worktree", () => {
    const mainDoc = makeDoc([makeItem({ id: "t1", status: "in_progress" })]);
    const wtDoc = makeDoc([makeItem({ id: "t1", status: "failing" })]);

    const { changes } = detectChanges(mainDoc, wtDoc);

    expect(changes).toHaveLength(1);
    expect(changes[0].worktreeStatus).toBe("failing");
  });

  it("skips tasks with unchanged status", () => {
    const mainDoc = makeDoc([makeItem({ id: "t1", status: "completed" })]);
    const wtDoc = makeDoc([makeItem({ id: "t1", status: "completed" })]);

    const { changes, skipped } = detectChanges(mainDoc, wtDoc);

    expect(changes).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips non-reconcilable statuses (pending, in_progress, etc.)", () => {
    const mainDoc = makeDoc([
      makeItem({ id: "t1", status: "pending" }),
      makeItem({ id: "t2", status: "completed" }),
    ]);
    const wtDoc = makeDoc([
      makeItem({ id: "t1", status: "in_progress" }),
      makeItem({ id: "t2", status: "completed" }),
    ]);

    const { changes, skipped } = detectChanges(mainDoc, wtDoc);

    expect(changes).toHaveLength(0);
    expect(skipped).toBe(2);
  });

  it("skips items not found in main PRD", () => {
    const mainDoc = makeDoc([]);
    const wtDoc = makeDoc([makeItem({ id: "t1", status: "completed" })]);

    const { changes, skipped } = detectChanges(mainDoc, wtDoc);

    expect(changes).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("handles nested items in the tree", () => {
    const mainDoc = makeDoc([
      makeItem({
        id: "f1",
        level: "feature",
        status: "in_progress",
        children: [
          makeItem({ id: "t1", status: "in_progress" }),
          makeItem({ id: "t2", status: "pending" }),
        ],
      }),
    ]);
    const wtDoc = makeDoc([
      makeItem({
        id: "f1",
        level: "feature",
        status: "in_progress",
        children: [
          makeItem({ id: "t1", status: "completed" }),
          makeItem({ id: "t2", status: "failing" }),
        ],
      }),
    ]);

    const { changes, totalExamined } = detectChanges(mainDoc, wtDoc);

    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.id).sort()).toEqual(["t1", "t2"]);
    // 3 items total: f1 + t1 + t2
    expect(totalExamined).toBe(3);
  });

  it("detects multiple changes across different levels", () => {
    const mainDoc = makeDoc([
      makeItem({ id: "t1", status: "in_progress" }),
      makeItem({ id: "t2", status: "pending" }),
      makeItem({ id: "t3", status: "in_progress" }),
    ]);
    const wtDoc = makeDoc([
      makeItem({ id: "t1", status: "completed" }),
      makeItem({ id: "t2", status: "completed" }),
      makeItem({ id: "t3", status: "failing" }),
    ]);

    const { changes } = detectChanges(mainDoc, wtDoc);

    expect(changes).toHaveLength(3);
  });
});

// ── applyChanges ────────────────────────────────────────────────────────────

describe("applyChanges", () => {
  it("applies a valid completed transition", async () => {
    const mainDoc = makeDoc([makeItem({ id: "t1", status: "in_progress" })]);
    const wtDoc = makeDoc([
      makeItem({ id: "t1", status: "completed", resolutionType: "code-change" }),
    ]);
    const store = makeStore(mainDoc);

    const changes: StatusChange[] = [{
      id: "t1",
      title: "Test Task",
      level: "task",
      mainStatus: "in_progress",
      worktreeStatus: "completed",
    }];

    const { reconciled, conflicts } = await applyChanges(store, changes, wtDoc);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].applied).toBe(true);
    expect(conflicts).toHaveLength(0);

    expect(store.updateItem).toHaveBeenCalledWith("t1", expect.objectContaining({
      status: "completed",
      resolutionType: "code-change",
    }));
  });

  it("applies a valid failing transition", async () => {
    const mainDoc = makeDoc([makeItem({ id: "t1", status: "in_progress" })]);
    const wtDoc = makeDoc([
      makeItem({ id: "t1", status: "failing", failureReason: "Tests broken" }),
    ]);
    const store = makeStore(mainDoc);

    const changes: StatusChange[] = [{
      id: "t1",
      title: "Test Task",
      level: "task",
      mainStatus: "in_progress",
      worktreeStatus: "failing",
    }];

    const { reconciled } = await applyChanges(store, changes, wtDoc);

    expect(reconciled).toHaveLength(1);
    expect(store.updateItem).toHaveBeenCalledWith("t1", expect.objectContaining({
      status: "failing",
      failureReason: "Tests broken",
    }));
  });

  it("records conflict for invalid transition", async () => {
    const mainDoc = makeDoc([makeItem({ id: "t1", status: "deleted" })]);
    const wtDoc = makeDoc([makeItem({ id: "t1", status: "completed" })]);
    const store = makeStore(mainDoc);

    const changes: StatusChange[] = [{
      id: "t1",
      title: "Test Task",
      level: "task",
      mainStatus: "deleted",
      worktreeStatus: "completed",
    }];

    const { reconciled, conflicts } = await applyChanges(store, changes, wtDoc);

    expect(reconciled).toHaveLength(0);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].applied).toBe(false);
    expect(conflicts[0].reason).toBeDefined();
    expect(store.updateItem).not.toHaveBeenCalled();
  });

  it("records conflict when store.updateItem throws", async () => {
    const mainDoc = makeDoc([makeItem({ id: "t1", status: "in_progress" })]);
    const wtDoc = makeDoc([makeItem({ id: "t1", status: "completed" })]);
    const store = makeStore(mainDoc);
    (store.updateItem as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Store write failed"),
    );

    const changes: StatusChange[] = [{
      id: "t1",
      title: "Test Task",
      level: "task",
      mainStatus: "in_progress",
      worktreeStatus: "completed",
    }];

    const { reconciled, conflicts } = await applyChanges(store, changes, wtDoc);

    expect(reconciled).toHaveLength(0);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe("Store write failed");
  });

  it("includes timestamp updates for completed transition", async () => {
    const mainDoc = makeDoc([makeItem({ id: "t1", status: "in_progress" })]);
    const wtDoc = makeDoc([makeItem({ id: "t1", status: "completed" })]);
    const store = makeStore(mainDoc);

    const changes: StatusChange[] = [{
      id: "t1",
      title: "Test Task",
      level: "task",
      mainStatus: "in_progress",
      worktreeStatus: "completed",
    }];

    await applyChanges(store, changes, wtDoc);

    expect(store.updateItem).toHaveBeenCalledWith("t1", expect.objectContaining({
      status: "completed",
      completedAt: expect.any(String),
    }));
  });
});

// ── reconcile (integration) ─────────────────────────────────────────────────

describe("reconcile", () => {
  it("returns full summary with reconciled, skipped, and conflicts", async () => {
    const mainDoc = makeDoc([
      makeItem({ id: "t1", status: "in_progress" }),
      makeItem({ id: "t2", status: "pending" }),
      makeItem({ id: "t3", status: "deleted" }),
    ]);
    const wtDoc = makeDoc([
      makeItem({ id: "t1", status: "completed" }),
      makeItem({ id: "t2", status: "pending" }),      // unchanged non-reconcilable
      makeItem({ id: "t3", status: "completed" }),     // invalid transition: deleted → completed
    ]);
    const store = makeStore(mainDoc);

    const summary = await reconcile(store, wtDoc);

    expect(summary.reconciled).toHaveLength(1);
    expect(summary.reconciled[0].id).toBe("t1");
    expect(summary.skipped).toBe(1);
    expect(summary.conflicts).toHaveLength(1);
    expect(summary.conflicts[0].id).toBe("t3");
    expect(summary.totalExamined).toBe(3);
  });

  it("logs each reconciled change", async () => {
    const mainDoc = makeDoc([makeItem({ id: "t1", status: "in_progress" })]);
    const wtDoc = makeDoc([makeItem({ id: "t1", status: "completed" })]);
    const store = makeStore(mainDoc);

    await reconcile(store, wtDoc);

    expect(store.appendLog).toHaveBeenCalledWith(expect.objectContaining({
      event: "parallel_reconciled",
      itemId: "t1",
    }));
  });

  it("logs conflicts", async () => {
    const mainDoc = makeDoc([makeItem({ id: "t1", status: "deleted" })]);
    const wtDoc = makeDoc([makeItem({ id: "t1", status: "completed" })]);
    const store = makeStore(mainDoc);

    await reconcile(store, wtDoc);

    expect(store.appendLog).toHaveBeenCalledWith(expect.objectContaining({
      event: "parallel_reconcile_conflict",
      itemId: "t1",
    }));
  });

  it("handles empty worktree PRD", async () => {
    const mainDoc = makeDoc([makeItem({ id: "t1", status: "pending" })]);
    const wtDoc = makeDoc([]);
    const store = makeStore(mainDoc);

    const summary = await reconcile(store, wtDoc);

    expect(summary.reconciled).toHaveLength(0);
    expect(summary.skipped).toBe(0);
    expect(summary.conflicts).toHaveLength(0);
    expect(summary.totalExamined).toBe(0);
  });

  it("handles empty main PRD", async () => {
    const mainDoc = makeDoc([]);
    const wtDoc = makeDoc([makeItem({ id: "t1", status: "completed" })]);
    const store = makeStore(mainDoc);

    const summary = await reconcile(store, wtDoc);

    expect(summary.reconciled).toHaveLength(0);
    // Item not found in main → skipped
    expect(summary.skipped).toBe(1);
  });

  it("copies resolution metadata on completed items", async () => {
    const mainDoc = makeDoc([makeItem({ id: "t1", status: "in_progress" })]);
    const wtDoc = makeDoc([
      makeItem({
        id: "t1",
        status: "completed",
        resolutionType: "code-change",
        resolutionDetail: "Implemented the widget",
      }),
    ]);
    const store = makeStore(mainDoc);

    await reconcile(store, wtDoc);

    expect(store.updateItem).toHaveBeenCalledWith("t1", expect.objectContaining({
      status: "completed",
      resolutionType: "code-change",
      resolutionDetail: "Implemented the widget",
    }));
  });

  it("copies failureReason on failing items", async () => {
    const mainDoc = makeDoc([makeItem({ id: "t1", status: "in_progress" })]);
    const wtDoc = makeDoc([
      makeItem({
        id: "t1",
        status: "failing",
        failureReason: "Tests broken after refactor",
      }),
    ]);
    const store = makeStore(mainDoc);

    await reconcile(store, wtDoc);

    expect(store.updateItem).toHaveBeenCalledWith("t1", expect.objectContaining({
      status: "failing",
      failureReason: "Tests broken after refactor",
    }));
  });
});
