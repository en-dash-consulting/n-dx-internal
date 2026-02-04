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
  it("updates task status", async () => {
    const store = mockStore();
    const result = await toolRexUpdateStatus(store, "task-1", {
      status: "in_progress",
    });
    expect(result).toContain("in_progress");
    expect(store.updateItem).toHaveBeenCalledWith("task-1", { status: "in_progress" });
    expect(store.appendLog).toHaveBeenCalled();
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
