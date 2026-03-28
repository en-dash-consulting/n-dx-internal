/**
 * Phase Panel — displays 4 grouped SourceVision analysis phases as interactive cards.
 *
 * Each card maps to multiple internal modules:
 *   Phase 1 Scan: inventory + imports + configsurface
 *   Phase 2 Classify: classifications + components
 *   Phase 3 Architecture: zones + callgraph
 *   Phase 4 Deep Analysis: zone enrichment passes 2–4 + meta-evaluation
 *
 * Data comes from GET /api/sv/phases which returns 4 grouped phase objects
 * with aggregated status, timestamps, and constituent module info.
 *
 * Run triggers are server-managed — a single POST /api/sv/phases/:n/run
 * spawns constituent modules in sequence. WebSocket "sv:phase-update"
 * events provide real-time status updates at the group level.
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";

// ── Types ────────────────────────────────────────────────────────────

/** Shape of a constituent module within a grouped phase. */
interface ModuleStatus {
  id: string;
  phase: number;
  name: string;
  status: "pending" | "running" | "complete" | "error";
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

/** Shape of a grouped phase from GET /api/sv/phases. */
interface GroupedPhase {
  group: number;
  name: string;
  description: string;
  status: "pending" | "running" | "complete" | "error";
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  modules: ModuleStatus[];
}

/** LLM cost tier for display. */
type LLMCost = "Free" | "Low" | "Medium" | "High";

/** Static display metadata per group. */
const GROUP_DISPLAY: Record<number, { llmCost: LLMCost }> = {
  1: { llmCost: "Free" },
  2: { llmCost: "Low" },
  3: { llmCost: "Medium" },
  4: { llmCost: "High" },
};

// ── Helpers ──────────────────────────────────────────────────────────

/** Status indicator symbols matching the CSS variants. */
const STATUS_INDICATOR: Record<string, { icon: string; label: string }> = {
  complete: { icon: "\u2713", label: "Complete" },
  running:  { icon: "\u25CF", label: "Running" },
  pending:  { icon: "\u2013", label: "Pending" },
  error:    { icon: "\u26A0", label: "Error" },
};

/** LLM cost display configuration. */
const COST_DISPLAY: Record<LLMCost, { label: string; cssClass: string }> = {
  Free:   { label: "Free",     cssClass: "phase-card__cost--free" },
  Low:    { label: "$ Low",    cssClass: "phase-card__cost--low" },
  Medium: { label: "$$ Med",   cssClass: "phase-card__cost--medium" },
  High:   { label: "$$$ High", cssClass: "phase-card__cost--high" },
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

/**
 * Get the most relevant display timestamp for a phase.
 * If running, shows startedAt. Otherwise shows completedAt.
 */
function getDisplayTimestamp(phase: GroupedPhase): string | null {
  if (phase.status === "running" && phase.startedAt) return phase.startedAt;
  return phase.completedAt;
}

// ── Component ────────────────────────────────────────────────────────

export function PhasePanel() {
  /** Grouped phase statuses from server (4 phases). */
  const [phases, setPhases] = useState<GroupedPhase[]>([]);
  const [loaded, setLoaded] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  /** Server-reported global lock state (includes cross-process PID checks). */
  const [serverAnyRunning, setServerAnyRunning] = useState(false);

  /** Whether any phase is currently running. */
  const anyRunning = serverAnyRunning || phases.some((p) => p.status === "running");

  // ── Data fetching ────────────────────────────────────────────────

  const fetchPhases = useCallback(async () => {
    try {
      const res = await fetch("/api/sv/phases");
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object" && Array.isArray(data.phases)) {
          setPhases(data.phases);
          setServerAnyRunning(!!data.anyRunning);
        }
        setLoaded(true);
      }
    } catch {
      // Silently fail — will retry on next poll
    }
  }, []);

  // ── WebSocket + polling ──────────────────────────────────────────

  useEffect(() => {
    let mounted = true;
    fetchPhases();

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
          if (msg.type === "sv:phase-update" && typeof msg.group === "number") {
            // Group-level update from server
            setPhases((prev) =>
              prev.map((p) =>
                p.group === msg.group
                  ? {
                      ...p,
                      status: msg.status ?? p.status,
                      startedAt: msg.startedAt ?? p.startedAt,
                      completedAt: msg.finishedAt ?? p.completedAt,
                      error: msg.error ?? null,
                    }
                  : p,
              ),
            );

            // If a group completed or errored, re-fetch for fresh data
            if (msg.status === "complete" || msg.status === "error" || msg.status === "pending") {
              fetchPhases();
            }
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

  const handleGroupRun = useCallback(async (group: GroupedPhase) => {
    // Optimistically mark as running
    setPhases((prev) =>
      prev.map((p) =>
        p.group === group.group
          ? { ...p, status: "running" as const, startedAt: new Date().toISOString() }
          : p,
      ),
    );

    try {
      const res = await fetch(`/api/sv/phases/${group.group}/run`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        console.error(`Failed to run phase ${group.group}:`, body.error ?? body);
        // Revert optimistic update
        await fetchPhases();
      }
    } catch (err) {
      console.error(`Error running phase ${group.group}:`, err);
      await fetchPhases();
    }
  }, [fetchPhases]);

  const handleGroupReset = useCallback(async (group: GroupedPhase) => {
    try {
      const res = await fetch(`/api/sv/phases/${group.group}/reset`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        console.error(`Failed to reset phase ${group.group}:`, body.error ?? body);
      }
    } catch (err) {
      console.error(`Error resetting phase ${group.group}:`, err);
    }
    // Re-fetch to pick up reset state
    await fetchPhases();
  }, [fetchPhases]);

  // Don't render until we have data
  if (!loaded) return null;

  // ── Render ───────────────────────────────────────────────────────

  return h("div", {
    class: "phase-panel",
    role: "region",
    "aria-label": "SourceVision analysis phases",
  },
    // Header
    h("div", { class: "phase-panel__header" },
      h("h3", null, "Analysis Phases"),
    ),

    // Phase cards grid — 4 grouped phases
    h("div", { class: "phase-panel__grid" },
      ...phases.map((phase) => {
        const indicator = STATUS_INDICATOR[phase.status] ?? STATUS_INDICATOR.pending;
        const ts = getDisplayTimestamp(phase);
        const display = GROUP_DISPLAY[phase.group] ?? { llmCost: "Free" as LLMCost };
        const cost = COST_DISPLAY[display.llmCost];
        const hasResetTarget = phase.status === "complete" || phase.status === "error"
          || phase.modules.some((m) => m.status === "complete" || m.status === "error");

        return h("div", {
          key: phase.group,
          class: `phase-card phase-card--${phase.status}`,
        },
          // Title row: group number + name + LLM cost indicator
          h("div", { class: "phase-card__title" },
            h("span", { class: "phase-card__number", "aria-hidden": "true" },
              String(phase.group),
            ),
            h("span", { class: "phase-card__name" }, phase.name),
            h("span", {
              class: `phase-card__cost ${cost.cssClass}`,
              title: `LLM cost: ${display.llmCost}`,
            }, cost.label),
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

          // Error message
          phase.error
            ? h("div", {
                class: "phase-card__timestamp",
                style: "color: var(--red); margin-top: 4px;",
                title: phase.error,
              }, phase.error.length > 80 ? phase.error.slice(0, 80) + "\u2026" : phase.error)
            : null,

          // Action buttons
          h("div", { class: "phase-card__actions" },
            h("button", {
              type: "button",
              disabled: anyRunning,
              title: anyRunning
                ? "A phase is already running"
                : `Run ${phase.name}`,
              onClick: () => handleGroupRun(phase),
            }, "Run"),
            hasResetTarget
              ? h("button", {
                  type: "button",
                  disabled: anyRunning,
                  title: `Reset ${phase.name}`,
                  onClick: () => handleGroupReset(phase),
                }, "Reset")
              : null,
          ),
        );
      }),
    ),
  );
}
