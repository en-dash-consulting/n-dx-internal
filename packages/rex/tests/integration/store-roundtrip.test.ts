import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore, ensureRexDir } from "../../src/store/index.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import type { PRDStore } from "../../src/store/index.js";
import type { PRDItem, PRDDocument } from "../../src/schema/index.js";

describe("Store roundtrip integration", () => {
  let rexDir: string;
  let store: PRDStore;

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "rex-integ-"));
    rexDir = join(tmpDir, ".rex");
    await ensureRexDir(rexDir);
    store = createStore("file", rexDir);

    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Integration Test",
      items: [],
    };
    await writeFile(join(rexDir, "prd.json"), toCanonicalJSON(doc), "utf-8");
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "test", adapter: "file" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Test Workflow", "utf-8");
  });

  afterEach(async () => {
    await rm(rexDir, { recursive: true, force: true });
  });

  it("full lifecycle: add items, read back, update, verify", async () => {
    // Add an epic
    const epic: PRDItem = {
      id: "epic-1",
      title: "Auth System",
      status: "pending",
      level: "epic",
      priority: "high",
    };
    await store.addItem(epic);

    // Add a feature under the epic
    const feature: PRDItem = {
      id: "feat-1",
      title: "OAuth Flow",
      status: "pending",
      level: "feature",
    };
    await store.addItem(feature, "epic-1");

    // Add tasks under the feature
    const task1: PRDItem = {
      id: "task-1",
      title: "Implement token exchange",
      status: "pending",
      level: "task",
      priority: "critical",
      acceptanceCriteria: ["Tokens exchanged", "Errors handled"],
    };
    const task2: PRDItem = {
      id: "task-2",
      title: "Add refresh logic",
      status: "pending",
      level: "task",
      blockedBy: ["task-1"],
    };
    await store.addItem(task1, "feat-1");
    await store.addItem(task2, "feat-1");

    // Read back the full document
    const doc = await store.loadDocument();
    expect(doc.items.length).toBe(1);
    expect(doc.items[0].children!.length).toBe(1);
    expect(doc.items[0].children![0].children!.length).toBe(2);

    // Get individual item
    const retrieved = await store.getItem("task-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.acceptanceCriteria).toEqual([
      "Tokens exchanged",
      "Errors handled",
    ]);

    // Update status
    await store.updateItem("task-1", { status: "completed" });
    const updated = await store.getItem("task-1");
    expect(updated!.status).toBe("completed");

    // Remove an item
    await store.removeItem("task-2");
    const afterRemove = await store.loadDocument();
    expect(afterRemove.items[0].children![0].children!.length).toBe(1);
  });

  it("passthrough preserves unknown fields", async () => {
    // Write doc with unknown fields directly
    const docWithExtras: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Extended",
      items: [
        {
          id: "e1",
          title: "Epic",
          status: "pending",
          level: "epic",
          customMeta: { internal: true },
        } as PRDItem,
      ],
      projectMeta: "preserved",
    } as PRDDocument;
    await store.saveDocument(docWithExtras);

    const reloaded = await store.loadDocument();
    expect((reloaded as Record<string, unknown>).projectMeta).toBe("preserved");
    expect((reloaded.items[0] as Record<string, unknown>).customMeta).toEqual({
      internal: true,
    });
  });

  it("log append and read", async () => {
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "session_start",
    });
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "item_added",
      itemId: "e1",
      detail: "Added epic",
    });
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "session_end",
    });

    const all = await store.readLog();
    expect(all.length).toBe(3);

    const last2 = await store.readLog(2);
    expect(last2.length).toBe(2);
    expect(last2[0].event).toBe("item_added");
    expect(last2[1].event).toBe("session_end");
  });
});
