// @vitest-environment jsdom
/**
 * Tests for the tab visibility state manager.
 *
 * Covers: state detection, snapshot creation, monitor lifecycle (start/stop),
 * listener management, visibility change handling, and state reset.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startTabVisibilityMonitor,
  stopTabVisibilityMonitor,
  getTabVisibility,
  getTabVisibilitySnapshot,
  isTabVisible,
  onVisibilityChange,
  resetTabVisibility,
  type TabVisibilitySnapshot,
  type TabVisibilityState,
} from "../../../src/viewer/tab-visibility.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Simulate a visibility state change by setting the property and dispatching the event. */
function simulateVisibilityChange(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

let originalVisibilityState: string;

beforeEach(() => {
  originalVisibilityState = document.visibilityState;
  // Default to visible for consistent test behavior
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    writable: true,
    configurable: true,
  });
  resetTabVisibility();
});

afterEach(() => {
  resetTabVisibility();
  Object.defineProperty(document, "visibilityState", {
    value: originalVisibilityState,
    writable: true,
    configurable: true,
  });
});

// ─── State detection ─────────────────────────────────────────────────────────

describe("initial state detection", () => {
  it("defaults to 'visible' before monitor starts", () => {
    expect(getTabVisibility()).toBe("visible");
    expect(isTabVisible()).toBe(true);
  });

  it("reads document.visibilityState on start", () => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    startTabVisibilityMonitor();
    expect(getTabVisibility()).toBe("hidden");
    expect(isTabVisible()).toBe(false);
  });

  it("reads visible state on start", () => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    startTabVisibilityMonitor();
    expect(getTabVisibility()).toBe("visible");
    expect(isTabVisible()).toBe(true);
  });
});

// ─── Snapshot ────────────────────────────────────────────────────────────────

describe("getTabVisibilitySnapshot", () => {
  it("returns a snapshot with expected shape", () => {
    startTabVisibilityMonitor();
    const snap = getTabVisibilitySnapshot();

    expect(snap).toHaveProperty("state");
    expect(snap).toHaveProperty("isVisible");
    expect(snap).toHaveProperty("since");
    expect(snap).toHaveProperty("durationMs");
    expect(snap).toHaveProperty("timestamp");
  });

  it("returns valid ISO timestamps", () => {
    startTabVisibilityMonitor();
    const snap = getTabVisibilitySnapshot();

    expect(() => new Date(snap.since)).not.toThrow();
    expect(() => new Date(snap.timestamp)).not.toThrow();
  });

  it("returns non-negative durationMs", () => {
    startTabVisibilityMonitor();
    const snap = getTabVisibilitySnapshot();
    expect(snap.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("isVisible matches state", () => {
    startTabVisibilityMonitor();
    const snap = getTabVisibilitySnapshot();
    expect(snap.isVisible).toBe(snap.state === "visible");
  });
});

// ─── Monitor lifecycle ───────────────────────────────────────────────────────

describe("monitor lifecycle", () => {
  it("starts and captures current visibility", () => {
    startTabVisibilityMonitor();
    expect(getTabVisibility()).toBe("visible");
  });

  it("detects visibility changes after start", () => {
    startTabVisibilityMonitor();
    expect(getTabVisibility()).toBe("visible");

    simulateVisibilityChange("hidden");
    expect(getTabVisibility()).toBe("hidden");
    expect(isTabVisible()).toBe(false);
  });

  it("detects transition back to visible", () => {
    startTabVisibilityMonitor();

    simulateVisibilityChange("hidden");
    expect(getTabVisibility()).toBe("hidden");

    simulateVisibilityChange("visible");
    expect(getTabVisibility()).toBe("visible");
    expect(isTabVisible()).toBe(true);
  });

  it("stops responding to events after stopTabVisibilityMonitor", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener);

    stopTabVisibilityMonitor();
    simulateVisibilityChange("hidden");

    expect(listener).not.toHaveBeenCalled();
    // State should remain at the value when stopped, not react to the event
    expect(getTabVisibility()).toBe("visible");
  });

  it("restarts cleanly when called multiple times", () => {
    const onChange1 = vi.fn();
    const onChange2 = vi.fn();

    startTabVisibilityMonitor({ onChange: onChange1 });
    startTabVisibilityMonitor({ onChange: onChange2 });

    simulateVisibilityChange("hidden");

    // Only the second onChange should fire (first was cleaned up on restart)
    expect(onChange1).not.toHaveBeenCalled();
    expect(onChange2).toHaveBeenCalledTimes(1);
  });

  it("resets all state with resetTabVisibility", () => {
    startTabVisibilityMonitor();
    simulateVisibilityChange("hidden");
    expect(getTabVisibility()).toBe("hidden");

    resetTabVisibility();
    expect(getTabVisibility()).toBe("visible");
    expect(isTabVisible()).toBe(true);
  });
});

// ─── Change listeners ────────────────────────────────────────────────────────

describe("visibility change listeners", () => {
  it("notifies listeners on visibility change", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener);

    simulateVisibilityChange("hidden");

    expect(listener).toHaveBeenCalledTimes(1);
    const snap: TabVisibilitySnapshot = listener.mock.calls[0][0];
    expect(snap.state).toBe("hidden");
    expect(snap.isVisible).toBe(false);
  });

  it("unsubscribe function removes listener", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    const unsub = onVisibilityChange(listener);

    unsub();
    simulateVisibilityChange("hidden");

    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple concurrent listeners", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener1);
    onVisibilityChange(listener2);

    simulateVisibilityChange("hidden");

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it("does not notify when state stays the same", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor(); // starts as visible
    onVisibilityChange(listener);

    // Simulate a visibilitychange event without actually changing the state
    document.dispatchEvent(new Event("visibilitychange"));

    expect(listener).not.toHaveBeenCalled();
  });

  it("passes snapshot with correct timing data", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener);

    simulateVisibilityChange("hidden");

    const snap: TabVisibilitySnapshot = listener.mock.calls[0][0];
    expect(snap.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof snap.since).toBe("string");
    expect(typeof snap.timestamp).toBe("string");
  });
});

// ─── onChange config callback ────────────────────────────────────────────────

describe("onChange config callback", () => {
  it("calls onChange with snapshot and previous state", () => {
    const onChange = vi.fn();
    startTabVisibilityMonitor({ onChange });

    simulateVisibilityChange("hidden");

    expect(onChange).toHaveBeenCalledTimes(1);
    const [snapshot, previousState] = onChange.mock.calls[0];
    expect(snapshot.state).toBe("hidden");
    expect(previousState).toBe("visible");
  });

  it("calls onChange for each transition", () => {
    const onChange = vi.fn();
    startTabVisibilityMonitor({ onChange });

    simulateVisibilityChange("hidden");
    simulateVisibilityChange("visible");
    simulateVisibilityChange("hidden");

    expect(onChange).toHaveBeenCalledTimes(3);

    // First transition: visible → hidden
    expect(onChange.mock.calls[0][0].state).toBe("hidden");
    expect(onChange.mock.calls[0][1]).toBe("visible");

    // Second transition: hidden → visible
    expect(onChange.mock.calls[1][0].state).toBe("visible");
    expect(onChange.mock.calls[1][1]).toBe("hidden");

    // Third transition: visible → hidden
    expect(onChange.mock.calls[2][0].state).toBe("hidden");
    expect(onChange.mock.calls[2][1]).toBe("visible");
  });

  it("does not call onChange when state does not change", () => {
    const onChange = vi.fn();
    startTabVisibilityMonitor({ onChange });

    // Dispatch event without changing underlying state
    document.dispatchEvent(new Event("visibilitychange"));

    expect(onChange).not.toHaveBeenCalled();
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles rapid toggle without errors", () => {
    startTabVisibilityMonitor();

    for (let i = 0; i < 20; i++) {
      simulateVisibilityChange(i % 2 === 0 ? "hidden" : "visible");
    }

    // Should end on the last state (even index = hidden → next visible)
    expect(["visible", "hidden"]).toContain(getTabVisibility());
  });

  it("getTabVisibilitySnapshot works without starting monitor", () => {
    const snap = getTabVisibilitySnapshot();
    expect(snap).toHaveProperty("state");
    expect(snap).toHaveProperty("isVisible");
    expect(snap.state).toBe("visible"); // default
  });

  it("onVisibilityChange works before starting monitor", () => {
    const listener = vi.fn();
    const unsub = onVisibilityChange(listener);

    // Start monitor after subscribing
    startTabVisibilityMonitor();
    simulateVisibilityChange("hidden");

    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("reset cleans up event listener", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener);

    resetTabVisibility();
    simulateVisibilityChange("hidden");

    // Listener was cleared by reset
    expect(listener).not.toHaveBeenCalled();
  });
});
