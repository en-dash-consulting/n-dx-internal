import { describe, it, expect } from "vitest";
import { formatTaskLine } from "../../../../src/cli/commands/task-lookup.js";

describe("formatTaskLine", () => {
  it("shows plain line when task exists", () => {
    const line = formatTaskLine("My Task", "task-123", true);
    expect(line).toBe("My Task (task-123)");
  });

  it("appends [task deleted] when task does not exist", () => {
    const line = formatTaskLine("Deleted Task", "task-old", false);
    expect(line).toBe("Deleted Task (task-old) [task deleted]");
  });

  it("shows plain line when task existence is unknown (null)", () => {
    const line = formatTaskLine("Unknown Task", "task-x", null);
    expect(line).toBe("Unknown Task (task-x)");
  });

  it("handles empty title gracefully", () => {
    const line = formatTaskLine("", "task-empty", false);
    expect(line).toBe(" (task-empty) [task deleted]");
  });
});
