import { describe, it, expect } from "vitest";
import {
  validateConfig,
  validateRunRecord,
  HenchConfigSchema,
  RunRecordSchema,
} from "../../../src/schema/validate.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";

describe("validateConfig", () => {
  it("accepts valid default config", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.schema).toBe("hench/v1");
      expect(result.data.model).toBe("sonnet");
      expect(result.data.provider).toBe("cli");
    }
  });

  it("rejects config with missing fields", () => {
    const result = validateConfig({ schema: "hench/v1" });
    expect(result.ok).toBe(false);
  });

  it("rejects config with invalid maxTurns", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), maxTurns: -1 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });

  it("accepts config with all fields", () => {
    const config = DEFAULT_HENCH_CONFIG();
    config.model = "claude-opus-4-20250514";
    config.maxTurns = 100;
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
  });
});

describe("validateRunRecord", () => {
  const validRun = {
    id: "test-id",
    taskId: "task-1",
    taskTitle: "Test task",
    startedAt: "2025-01-01T00:00:00Z",
    status: "completed",
    turns: 5,
    tokenUsage: { input: 1000, output: 500 },
    toolCalls: [],
    model: "claude-sonnet-4-20250514",
  };

  it("accepts valid run record", () => {
    const result = validateRunRecord(validRun);
    expect(result.ok).toBe(true);
  });

  it("accepts run with optional fields", () => {
    const run = {
      ...validRun,
      finishedAt: "2025-01-01T00:05:00Z",
      summary: "Did some work",
      error: undefined,
    };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("accepts run with tool calls", () => {
    const run = {
      ...validRun,
      toolCalls: [
        {
          turn: 1,
          tool: "read_file",
          input: { path: "test.ts" },
          output: "content",
          durationMs: 10,
        },
      ],
    };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("rejects run with invalid status", () => {
    const run = { ...validRun, status: "invalid" };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(false);
  });

  it("rejects run with missing required fields", () => {
    const result = validateRunRecord({ id: "test" });
    expect(result.ok).toBe(false);
  });
});
