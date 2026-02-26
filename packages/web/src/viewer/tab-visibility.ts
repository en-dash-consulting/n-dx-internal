/**
 * Centralized tab visibility state manager.
 *
 * Wraps the Page Visibility API to provide a single source of truth for
 * browser tab visibility state. All polling components subscribe to this
 * module instead of independently listening for visibility changes.
 *
 * State transitions:
 *
 *   visible → hidden   Tab is backgrounded, minimized, or screen-locked.
 *   hidden  → visible  Tab regains focus or is foregrounded.
 *
 * Designed as a standalone module with zero framework dependencies —
 * the Preact hook (`useTabVisibility`) is provided separately.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Tab visibility state, mirrors `document.visibilityState`. */
export type TabVisibilityState = "visible" | "hidden";

/** Snapshot of the current tab visibility state at a point in time. */
export interface TabVisibilitySnapshot {
  /** Current visibility state. */
  readonly state: TabVisibilityState;
  /** Whether the tab is currently visible (convenience boolean). */
  readonly isVisible: boolean;
  /** ISO timestamp of when the current state began. */
  readonly since: string;
  /** Milliseconds spent in the current state. */
  readonly durationMs: number;
  /** ISO timestamp of when this snapshot was taken. */
  readonly timestamp: string;
}

/** Callback invoked when tab visibility changes. */
export type VisibilityChangeHandler = (
  snapshot: TabVisibilitySnapshot,
  previousState: TabVisibilityState
) => void;

/** Configuration for the tab visibility monitor. */
export interface TabVisibilityConfig {
  /** Called when tab visibility changes. */
  onChange: VisibilityChangeHandler | null;
}

// ─── Module state ────────────────────────────────────────────────────────────

let currentState: TabVisibilityState = "visible";
let stateChangedAt: number = Date.now();
let config: TabVisibilityConfig = { onChange: null };
let listeners: Array<(snapshot: TabVisibilitySnapshot) => void> = [];
let boundHandler: (() => void) | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a snapshot from current module state. */
function buildSnapshot(): TabVisibilitySnapshot {
  const now = Date.now();
  return {
    state: currentState,
    isVisible: currentState === "visible",
    since: new Date(stateChangedAt).toISOString(),
    durationMs: now - stateChangedAt,
    timestamp: new Date(now).toISOString(),
  };
}

function notifyListeners(snapshot: TabVisibilitySnapshot): void {
  for (const listener of listeners) {
    listener(snapshot);
  }
}

/** Read the current visibility state from the document API. */
function readDocumentVisibility(): TabVisibilityState {
  if (typeof document === "undefined") return "visible";
  return document.visibilityState === "visible" ? "visible" : "hidden";
}

// ─── Event handler ───────────────────────────────────────────────────────────

function handleVisibilityChange(): void {
  const newState = readDocumentVisibility();

  if (newState === currentState) return;

  const previousState = currentState;
  currentState = newState;
  stateChangedAt = Date.now();

  const snapshot = buildSnapshot();

  if (config.onChange) {
    config.onChange(snapshot, previousState);
  }

  notifyListeners(snapshot);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the tab visibility monitor. Listens for `visibilitychange` events
 * and immediately captures the current state.
 *
 * Safe to call multiple times — restarts with new config.
 */
export function startTabVisibilityMonitor(
  overrides: Partial<TabVisibilityConfig> = {}
): void {
  stopTabVisibilityMonitor();

  config = {
    onChange: overrides.onChange ?? null,
  };

  // Capture the current state immediately.
  currentState = readDocumentVisibility();
  stateChangedAt = Date.now();

  // Bind and register the event listener.
  if (typeof document !== "undefined") {
    boundHandler = handleVisibilityChange;
    document.addEventListener("visibilitychange", boundHandler);
  }
}

/** Stop the tab visibility monitor and remove the event listener. */
export function stopTabVisibilityMonitor(): void {
  if (boundHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", boundHandler);
    boundHandler = null;
  }
}

/** Subscribe to visibility change events. Returns an unsubscribe function. */
export function onVisibilityChange(
  listener: (snapshot: TabVisibilitySnapshot) => void
): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Get the current tab visibility state. */
export function getTabVisibility(): TabVisibilityState {
  return currentState;
}

/** Get a full snapshot of the current tab visibility state. */
export function getTabVisibilitySnapshot(): TabVisibilitySnapshot {
  return buildSnapshot();
}

/** Convenience check: is the tab currently visible? */
export function isTabVisible(): boolean {
  return currentState === "visible";
}

/** Reset all module state (for testing). */
export function resetTabVisibility(): void {
  stopTabVisibilityMonitor();
  currentState = "visible";
  stateChangedAt = Date.now();
  config = { onChange: null };
  listeners = [];
}
