/**
 * Preact hook for shared elapsed-time tick updates.
 *
 * Wraps the tick timer service to provide a simple hook interface for
 * components that display live elapsed durations (e.g. task cards with
 * running timers). All components share a single 1-second setInterval,
 * reducing CPU overhead when many cards are visible simultaneously.
 *
 * Usage:
 * ```tsx
 * // Replace:
 * //   const [elapsed, setElapsed] = useState(() => formatElapsed(startedAt));
 * //   useEffect(() => {
 * //     const id = setInterval(() => setElapsed(formatElapsed(startedAt)), 1000);
 * //     return () => clearInterval(id);
 * //   }, [startedAt]);
 * //
 * // With:
 * const elapsed = useTick(startedAt, formatElapsed);
 * ```
 */

import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { onTick } from "../tick-timer.js";

/**
 * Subscribe to the shared 1-second tick timer and return a formatted
 * elapsed-time string that updates every second.
 *
 * @param startedAt - ISO 8601 timestamp of when the timer began.
 * @param formatter - Pure function that converts a start timestamp to a
 *                    display string. Called once per tick.
 *                    Receives the ISO string and returns the formatted output.
 * @returns The current formatted elapsed-time string.
 */
export function useTick(
  startedAt: string,
  formatter: (startedAt: string) => string,
): string {
  // Keep refs current so the tick callback always uses the latest values
  // without resubscribing to the timer.
  const startedAtRef = useRef(startedAt);
  startedAtRef.current = startedAt;

  const formatterRef = useRef(formatter);
  formatterRef.current = formatter;

  const compute = useCallback(
    () => formatterRef.current(startedAtRef.current),
    [],
  );

  const [display, setDisplay] = useState(compute);

  // Re-compute immediately when startedAt changes.
  useEffect(() => {
    setDisplay(compute());
  }, [startedAt, compute]);

  // Subscribe to the shared tick timer.
  useEffect(() => {
    const unsub = onTick(() => {
      setDisplay(compute());
    });
    return unsub;
  }, [compute]);

  return display;
}
