import { describe, it, expect, vi } from "vitest";
import { toolRexUpdateStatus, toolRexAppendLog, toolRexAddSubtask } from "../../../src/tools/rex.js";

function mockStore() {
  return {
    updateItem: vi.fn().mockResolvedValue(undefined),
    appendLog: vi.fn().mockResolvedValue(undefined),
    addItem: vi.fn().mockResolvedValue(undefined),
    loadDocument: vi.fn(),
    saveDocument: vi.fn(),
    getItem: vi.fn(),
    removeItem: vi.fn(),
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
    readLog: vi.fn(),
    loadWorkflow: vi.fn(),
    saveWorkflow: vi.fn(),
    capabilities: vi.fn(),
  };
}

describe("toolRexUpdateStatus", () => {
  it("updates task status and sets timestamps", async () => {
    const store = mockStore();
    store.getItem.mockResolvedValue({
      id: "task-1",
      title: "Test task",
      status: "pending",
      level: "task",
    });
    const result = await toolRexUpdateStatus(store, "task-1", {
      status: "in_progress",
    });
    expect(result).toContain("in_progress");
    expect(store.updateItem).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "in_progress", startedAt: expect.any(String) }),
    );
    expect(store.appendLog).toHaveBeenCalled();
  });

  it("preserves existing startedAt when completing", async () => {
    const store = mockStore();
    const taskItem = {
      id: "task-1",
      title: "Test task",
      status: "in_progress",
      level: "task",
      startedAt: "2025-01-01T00:00:00.000Z",
    };
    store.getItem.mockResolvedValue(taskItem);
    store.loadDocument.mockResolvedValue({
      schema: "rex/v1",
      title: "Test",
      items: [taskItem],
    });
    await toolRexUpdateStatus(store, "task-1", { status: "completed" });
    const call = store.updateItem.mock.calls[0][1];
    expect(call.status).toBe("completed");
    expect(call.completedAt).toBeDefined();
    expect(call.startedAt).toBeUndefined(); // not overwritten
  });

  it("auto-completes parent when all children done", async () => {
    const store = mockStore();
    const taskItem = {
      id: "task-2",
      title: "Last task",
      status: "in_progress",
      level: "task",
    };
    const parentItem = {
      id: "feature-1",
      title: "Feature",
      status: "in_progress",
      level: "feature",
      children: [
        { id: "task-1", title: "First task", status: "completed", level: "task" },
        taskItem,
      ],
    };
    store.getItem.mockImplementation(async (id: string) => {
      if (id === "task-2") return taskItem;
      if (id === "feature-1") return parentItem;
      return null;
    });
    store.loadDocument.mockResolvedValue({
      schema: "rex/v1",
      title: "Test",
      items: [parentItem],
    });
    const result = await toolRexUpdateStatus(store, "task-2", { status: "completed" });
    expect(result).toContain("Auto-completed");
    expect(result).toContain("Feature");
    // Should have updated parent too (2 updateItem calls total)
    expect(store.updateItem).toHaveBeenCalledTimes(2);
    expect(store.updateItem).toHaveBeenCalledWith(
      "feature-1",
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("rejects invalid status", async () => {
    const store = mockStore();
    await expect(
      toolRexUpdateStatus(store, "task-1", { status: "invalid" }),
    ).rejects.toThrow("Invalid status");
  });
});

describe("toolRexAppendLog", () => {
  it("appends log entry", async () => {
    const store = mockStore();
    const result = await toolRexAppendLog(store, "task-1", {
      event: "test_passed",
      detail: "All tests passed",
    });
    expect(result).toContain("test_passed");
    expect(store.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "test_passed",
        itemId: "task-1",
        detail: "All tests passed",
      }),
    );
  });
});

describe("toolRexAddSubtask", () => {
  it("creates subtask", async () => {
    const store = mockStore();
    const result = await toolRexAddSubtask(store, "task-1", {
      title: "Write tests",
      description: "Add unit tests",
      priority: "high",
    });
    expect(result).toContain("Write tests");
    expect(store.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Write tests",
        level: "subtask",
        status: "pending",
        priority: "high",
      }),
      "task-1",
    );
  });

  it("rejects invalid priority", async () => {
    const store = mockStore();
    await expect(
      toolRexAddSubtask(store, "task-1", {
        title: "Test",
        priority: "invalid",
      }),
    ).rejects.toThrow("Invalid priority");
  });
});
