/**
 * Phase Panel — displays all 7 SourceVision analysis phases as interactive cards.
 *
 * Each card shows phase number, name, brief description, status indicator
 * (checkmark for complete, animated dot for running, dash for pending, warning for error),
 * relative timestamp for last run, and Run/Reset action buttons.
 *
 * Data comes from GET /api/sv/phases (initial fetch + polling fallback)
 * and WebSocket "sv:phase-update" events (real-time updates without polling).
 *
 * Run button is disabled when any phase is currently executing.
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";

// ── Types ────────────────────────────────────────────────────────────

/** Shape of a single phase from GET /api/sv/phases. */
interface PhaseStatus {
  id: string;
  phase: number;
  name: string;
  description: string;
  status: "pending" | "running" | "complete" | "error";
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Status indicator symbols matching the CSS variants. */
const STATUS_INDICATOR: Record<PhaseStatus["status"], { icon: string; label: string }> = {
  complete: { icon: "✓", label: "Complete" },
  running:  { icon: "●", label: "Running" },
  pending:  { icon: "–", label: "Pending" },
  error:    { icon: "⚠", label: "Error" },
};

/**
 * Format a timestamp as a relative time string (e.g. "2m ago", "3h ago").
 * Falls back to locale date string for timestamps older than 24h.
 */
function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1_000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(isoDate).toLocaleDateString();
}

/** Determine the most relevant timestamp for display. */
function getDisplayTimestamp(phase: PhaseStatus): string | null {
  if (phase.status === "running" && phase.startedAt) return phase.startedAt;
  if (phase.completedAt) return phase.completedAt;
  if (phase.startedAt) return phase.startedAt;
  return null;
}

// ── Component ────────────────────────────────────────────────────────

export function PhasePanel() {
  const [phases, setPhases] = useState<PhaseStatus[]>([]);
  const [loaded, setLoaded] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  /** Server-reported global lock state (includes cross-process PID checks). */
  const [serverAnyRunning, setServerAnyRunning] = useState(false);

  /**
   * Whether any phase is currently running.
   *
   * Combines server-side cross-process PID verification (`anyRunning` from
   * GET /api/sv/phases) with client-side status derived from WebSocket
   * updates. The server flag catches external CLI processes; the client
   * flag stays current between polls via real-time WebSocket messages.
   */
  const anyRunning = serverAnyRunning || phases.some((p) => p.status === "running");

  // Fetch from REST endpoint
  const fetchPhases = useCallback(async () => {
    try {
      const res = await fetch("/api/sv/phases");
      if (res.ok) {
        const data = await res.json();
        // Response is { phases: PhaseStatus[], anyRunning: boolean }
        if (data && typeof data === "object" && Array.isArray(data.phases)) {
          setPhases(data.phases);
          setServerAnyRunning(!!data.anyRunning);
        } else if (Array.isArray(data)) {
          // Backward compatibility: plain array response
          setPhases(data);
          setServerAnyRunning(false);
        }
        setLoaded(true);
      }
    } catch {
      // Silently fail — will retry on next poll
    }
  }, []);

  // WebSocket + polling
  useEffect(() => {
    let mounted = true;
    fetchPhases();

    // Connect to WebSocket for real-time updates
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}`;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (!mounted) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "sv:phase-update") {
            setPhases((prev) =>
              prev.map((p) =>
                p.phase === msg.phase
                  ? {
                      ...p,
                      status: msg.status,
                      startedAt: msg.startedAt ?? p.startedAt,
                      completedAt: msg.finishedAt ?? p.completedAt,
                      error: msg.error ?? null,
                    }
                  : p,
              ),
            );
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => { wsRef.current = null; };
    } catch {
      // WebSocket not available
    }

    // Poll as fallback every 30 seconds
    const interval = setInterval(fetchPhases, 30_000);

    return () => {
      mounted = false;
      clearInterval(interval);
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
      wsRef.current = null;
    };
  }, [fetchPhases]);

  // ── Action handlers ──────────────────────────────────────────────

  const handleRun = useCallback(async (phase: number) => {
    try {
      const res = await fetch(`/api/sv/phases/${phase}/run`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        console.error(`Failed to run phase ${phase}:`, body.error ?? body);
      }
      // Server broadcasts sv:phase-update — state updates via WebSocket
    } catch (err) {
      console.error(`Error running phase ${phase}:`, err);
    }
  }, []);

  const handleReset = useCallback(async (phase: number) => {
    try {
      const res = await fetch(`/api/sv/phases/${phase}/reset`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        console.error(`Failed to reset phase ${phase}:`, body.error ?? body);
        return;
      }
      // Re-fetch to pick up the reset state
      await fetchPhases();
    } catch (err) {
      console.error(`Error resetting phase ${phase}:`, err);
    }
  }, [fetchPhases]);

  // Don't render until we have data
  if (!loaded) return null;

  return h("div", {
    class: "phase-panel",
    role: "region",
    "aria-label": "SourceVision analysis phases",
  },
    // Header
    h("div", { class: "phase-panel__header" },
      h("h3", null, "Analysis Phases"),
    ),

    // Phase cards grid
    h("div", { class: "phase-panel__grid" },
      ...phases.map((phase) => {
        const indicator = STATUS_INDICATOR[phase.status];
        const ts = getDisplayTimestamp(phase);

        return h("div", {
          key: phase.id,
          class: `phase-card phase-card--${phase.status}`,
        },
          // Title row: number + name
          h("div", { class: "phase-card__title" },
            h("span", { class: "phase-card__number", "aria-hidden": "true" },
              String(phase.phase),
            ),
            h("span", { class: "phase-card__name" }, phase.name),
          ),

          // Description
          h("p", {
            class: "phase-card__description",
            style: "margin: 0 0 8px; font-size: 11px; color: var(--text-dim); line-height: 1.4;",
          }, phase.description),

          // Status badge with indicator
          h("span", {
            class: "phase-card__status",
            "aria-label": `Status: ${indicator.label}`,
          },
            h("span", { "aria-hidden": "true" }, indicator.icon),
            " ",
            indicator.label,
          ),

          // Relative timestamp
          ts
            ? h("div", { class: "phase-card__timestamp" },
                phase.status === "running" ? `Started ${formatRelativeTime(ts)}` : formatRelativeTime(ts),
              )
            : null,

          // Error message (truncated)
          phase.error
            ? h("div", {
                class: "phase-card__timestamp",
                style: "color: var(--red); margin-top: 4px;",
                title: phase.error,
              }, phase.error.length > 80 ? phase.error.slice(0, 80) + "…" : phase.error)
            : null,

          // Action buttons
          h("div", { class: "phase-card__actions" },
            h("button", {
              type: "button",
              disabled: anyRunning,
              title: anyRunning
                ? "A phase is already running"
                : `Run phase ${phase.phase}: ${phase.name}`,
              onClick: () => handleRun(phase.phase),
            }, "Run"),
            phase.status === "complete" || phase.status === "error"
              ? h("button", {
                  type: "button",
                  disabled: anyRunning,
                  title: `Reset phase ${phase.phase}: ${phase.name}`,
                  onClick: () => handleReset(phase.phase),
                }, "Reset")
              : null,
          ),
        );
      }),
    ),
  );
}
