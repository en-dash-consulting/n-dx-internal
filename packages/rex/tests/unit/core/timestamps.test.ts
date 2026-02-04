import { describe, it, expect, vi, afterEach } from "vitest";
import { computeTimestampUpdates } from "../../../src/core/timestamps.js";

describe("computeTimestampUpdates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets startedAt when moving to in_progress", () => {
    const now = "2025-01-15T10:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("pending", "in_progress");
    expect(result).toEqual({ startedAt: now });
  });

  it("sets only completedAt when item already has startedAt", () => {
    const now = "2025-01-15T12:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("in_progress", "completed", {
      startedAt: "2025-01-15T10:00:00.000Z",
    });
    expect(result).toEqual({ completedAt: now });
  });

  it("sets both startedAt and completedAt when completing without startedAt", () => {
    const now = "2025-01-15T12:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("in_progress", "completed");
    expect(result).toEqual({ startedAt: now, completedAt: now });
  });

  it("sets both startedAt and completedAt when skipping from pending to completed", () => {
    const now = "2025-01-15T12:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("pending", "completed");
    expect(result).toEqual({ startedAt: now, completedAt: now });
  });

  it("clears completedAt and sets startedAt when moving from completed to in_progress", () => {
    const now = "2025-01-15T14:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("completed", "in_progress");
    expect(result).toEqual({ startedAt: now, completedAt: undefined });
  });

  it("preserves startedAt when moving from completed to in_progress if already set", () => {
    const now = "2025-01-15T14:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("completed", "in_progress", {
      startedAt: "2025-01-15T10:00:00.000Z",
    });
    expect(result).toEqual({ completedAt: undefined });
  });

  it("clears completedAt when moving from completed to pending (forced)", () => {
    const result = computeTimestampUpdates("completed", "pending");
    expect(result).toEqual({ completedAt: undefined });
  });

  it("returns empty object for no-op same-status transition", () => {
    const result = computeTimestampUpdates("pending", "pending");
    expect(result).toEqual({});
  });

  it("returns empty object for transitions that don't affect timestamps", () => {
    const result = computeTimestampUpdates("pending", "deferred");
    expect(result).toEqual({});
  });

  it("returns empty object for blocked transitions", () => {
    const result = computeTimestampUpdates("in_progress", "blocked");
    expect(result).toEqual({});
  });

  it("sets startedAt when moving from blocked to in_progress", () => {
    const now = "2025-01-15T14:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("blocked", "in_progress");
    expect(result).toEqual({ startedAt: now });
  });

  it("sets startedAt when moving from deferred to in_progress", () => {
    const now = "2025-01-15T14:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("deferred", "in_progress");
    expect(result).toEqual({ startedAt: now });
  });

  it("does not set startedAt when item already has one (uses existing)", () => {
    const now = "2025-01-15T14:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("blocked", "in_progress", {
      startedAt: "2025-01-10T08:00:00.000Z",
    });
    expect(result).toEqual({});
  });

  it("sets startedAt even if item has none when resuming", () => {
    const now = "2025-01-15T14:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("blocked", "in_progress", {});
    expect(result).toEqual({ startedAt: now });
  });
});
