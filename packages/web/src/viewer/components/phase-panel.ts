/**
 * Phase Panel — displays 4 grouped SourceVision analysis phases as interactive cards.
 *
 * Each card maps to multiple internal modules:
 *   Phase 1 Scan: inventory + imports + configsurface
 *   Phase 2 Classify: classifications + components
 *   Phase 3 Architecture: zones + callgraph
 *   Phase 4 Deep Analysis: zone enrichment passes 2–4 + meta-evaluation
 *
 * Data comes from GET /api/sv/phases (returns 7 module statuses) which are
 * aggregated into 4 group statuses on the client side.
 *
 * Run triggers constituent modules sequentially via existing single-module endpoints.
 * WebSocket "sv:phase-update" events provide real-time status updates.
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";

// ── Types ────────────────────────────────────────────────────────────

/** Shape of a single module from GET /api/sv/phases. */
interface ModuleStatus {
  id: string;
  phase: number;
  name: string;
  description: string;
  status: "pending" | "running" | "complete" | "error";
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

/** LLM cost tier for display. */
type LLMCost = "Free" | "Low" | "Medium" | "High";

/** Definition of a grouped phase. */
interface PhaseGroup {
  /** Display group number (1–4). */
  group: number;
  name: string;
  description: string;
  /** Module IDs from the manifest (used for status aggregation). */
  moduleIds: readonly string[];
  /** Old phase numbers (1–7) for triggering via existing endpoints. */
  modulePhases: readonly number[];
  llmCost: LLMCost;
}

// ── Phase group definitions ─────────────────────────────────────────

const PHASE_GROUPS: readonly PhaseGroup[] = [
  {
    group: 1,
    name: "Scan",
    description: "Catalog files, build dependency graph, and detect configuration surface",
    moduleIds: ["inventory", "imports", "configsurface"],
    modulePhases: [1, 2, 7],
    llmCost: "Free",
  },
  {
    group: 2,
    name: "Classify",
    description: "Classify files by archetype and catalog React/Preact components",
    moduleIds: ["classifications", "components"],
    modulePhases: [3, 5],
    llmCost: "Low",
  },
  {
    group: 3,
    name: "Architecture",
    description: "Detect architectural zones and analyze function-level call patterns",
    moduleIds: ["zones", "callgraph"],
    modulePhases: [4, 6],
    llmCost: "Medium",
  },
  {
    group: 4,
    name: "Deep Analysis",
    description: "Zone enrichment passes 2\u20134 and meta-evaluation for comprehensive insights",
    moduleIds: [],
    modulePhases: [],
    llmCost: "High",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

/** Status indicator symbols matching the CSS variants. */
const STATUS_INDICATOR: Record<ModuleStatus["status"], { icon: string; label: string }> = {
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

/** Aggregate status from constituent modules into a single group status. */
function aggregateStatus(groupModules: ModuleStatus[]): ModuleStatus["status"] {
  if (groupModules.length === 0) return "pending";
  if (groupModules.some((m) => m.status === "running")) return "running";
  if (groupModules.some((m) => m.status === "error")) return "error";
  if (groupModules.every((m) => m.status === "complete")) return "complete";
  return "pending";
}

/**
 * Get the most relevant display timestamp for a group of modules.
 * If any module is running, shows its startedAt.
 * Otherwise, returns the latest completedAt across all modules.
 */
function getGroupTimestamp(groupModules: ModuleStatus[]): string | null {
  // If any module is running, show its startedAt
  for (const m of groupModules) {
    if (m.status === "running" && m.startedAt) return m.startedAt;
  }
  // Otherwise show the most recent completedAt
  let latest: string | null = null;
  for (const m of groupModules) {
    if (m.completedAt && (!latest || m.completedAt > latest)) {
      latest = m.completedAt;
    }
  }
  return latest;
}

// ── Component ────────────────────────────────────────────────────────

export function PhasePanel() {
  /** Raw module statuses from server (7 individual modules). */
  const [modules, setModules] = useState<ModuleStatus[]>([]);
  const [loaded, setLoaded] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  /** Server-reported global lock state (includes cross-process PID checks). */
  const [serverAnyRunning, setServerAnyRunning] = useState(false);

  /**
   * Queue of module phase numbers to run sequentially.
   * When the first item completes, it is shifted off and the next is triggered.
   */
  const runQueueRef = useRef<number[]>([]);
  const [queueActive, setQueueActive] = useState(false);

  /**
   * Whether any module is currently running.
   * Combines server-side cross-process PID verification with client-side status.
   */
  const anyRunning = serverAnyRunning || modules.some((m) => m.status === "running") || queueActive;

  // ── Data fetching ────────────────────────────────────────────────

  const fetchPhases = useCallback(async () => {
    try {
      const res = await fetch("/api/sv/phases");
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object" && Array.isArray(data.phases)) {
          setModules(data.phases);
          setServerAnyRunning(!!data.anyRunning);
        } else if (Array.isArray(data)) {
          // Backward compatibility: plain array response
          setModules(data);
          setServerAnyRunning(false);
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
          if (msg.type === "sv:phase-update") {
            setModules((prev) =>
              prev.map((m) =>
                m.phase === msg.phase
                  ? {
                      ...m,
                      status: msg.status,
                      startedAt: msg.startedAt ?? m.startedAt,
                      completedAt: msg.finishedAt ?? m.completedAt,
                      error: msg.error ?? null,
                    }
                  : m,
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

  // ── Sequential queue runner ──────────────────────────────────────
  //
  // Watches module status changes. When the current queue head completes,
  // shifts the queue and triggers the next module. Stops on error.

  const triggerModuleRun = useCallback(async (phase: number) => {
    try {
      const res = await fetch(`/api/sv/phases/${phase}/run`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        console.error(`Failed to run module phase ${phase}:`, body.error ?? body);
        runQueueRef.current = [];
        setQueueActive(false);
        // Re-fetch to correct any optimistic status
        await fetchPhases();
      }
    } catch (err) {
      console.error(`Error running module phase ${phase}:`, err);
      runQueueRef.current = [];
      setQueueActive(false);
      await fetchPhases();
    }
  }, [fetchPhases]);

  useEffect(() => {
    const queue = runQueueRef.current;
    if (queue.length === 0) return;

    const currentPhase = queue[0];
    const mod = modules.find((m) => m.phase === currentPhase);
    if (!mod) return;

    if (mod.status === "error") {
      // Stop queue on error
      runQueueRef.current = [];
      setQueueActive(false);
      return;
    }

    if (mod.status === "complete") {
      // Current module completed — advance to next
      runQueueRef.current = queue.slice(1);
      const nextQueue = runQueueRef.current;

      if (nextQueue.length === 0) {
        setQueueActive(false);
        return;
      }

      // Optimistically mark next module as running to prevent false advance
      const nextPhase = nextQueue[0];
      setModules((prev) =>
        prev.map((m) =>
          m.phase === nextPhase
            ? { ...m, status: "running" as const, startedAt: new Date().toISOString() }
            : m,
        ),
      );
      triggerModuleRun(nextPhase);
    }
  }, [modules, triggerModuleRun]);

  // ── Action handlers ──────────────────────────────────────────────

  const handleGroupRun = useCallback((group: PhaseGroup) => {
    if (group.modulePhases.length === 0) return;

    // Set up the run queue with all constituent module phases
    runQueueRef.current = [...group.modulePhases];
    setQueueActive(true);

    // Optimistically mark first module as running
    const firstPhase = group.modulePhases[0];
    setModules((prev) =>
      prev.map((m) =>
        m.phase === firstPhase
          ? { ...m, status: "running" as const, startedAt: new Date().toISOString() }
          : m,
      ),
    );

    triggerModuleRun(firstPhase);
  }, [triggerModuleRun]);

  const handleGroupReset = useCallback(async (group: PhaseGroup) => {
    for (const phase of group.modulePhases) {
      try {
        const res = await fetch(`/api/sv/phases/${phase}/reset`, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Request failed" }));
          console.error(`Failed to reset module phase ${phase}:`, body.error ?? body);
        }
      } catch (err) {
        console.error(`Error resetting module phase ${phase}:`, err);
      }
    }
    // Re-fetch to pick up all reset states
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
      ...PHASE_GROUPS.map((group) => {
        // Resolve constituent module statuses for this group
        const groupModules = group.moduleIds
          .map((id) => modules.find((m) => m.id === id))
          .filter((m): m is ModuleStatus => m != null);

        const status = aggregateStatus(groupModules);
        const indicator = STATUS_INDICATOR[status];
        const ts = getGroupTimestamp(groupModules);
        const cost = COST_DISPLAY[group.llmCost];
        const hasResetTarget = groupModules.some(
          (m) => m.status === "complete" || m.status === "error",
        );
        const canRun = group.modulePhases.length > 0;

        return h("div", {
          key: group.group,
          class: `phase-card phase-card--${status}`,
        },
          // Title row: group number + name + LLM cost indicator
          h("div", { class: "phase-card__title" },
            h("span", { class: "phase-card__number", "aria-hidden": "true" },
              String(group.group),
            ),
            h("span", { class: "phase-card__name" }, group.name),
            h("span", {
              class: `phase-card__cost ${cost.cssClass}`,
              title: `LLM cost: ${group.llmCost}`,
            }, cost.label),
          ),

          // Description
          h("p", {
            class: "phase-card__description",
            style: "margin: 0 0 8px; font-size: 11px; color: var(--text-dim); line-height: 1.4;",
          }, group.description),

          // Status badge with indicator
          h("span", {
            class: "phase-card__status",
            "aria-label": `Status: ${indicator.label}`,
          },
            h("span", { "aria-hidden": "true" }, indicator.icon),
            " ",
            indicator.label,
          ),

          // Relative timestamp (latest completedAt across constituent modules)
          ts
            ? h("div", { class: "phase-card__timestamp" },
                status === "running" ? `Started ${formatRelativeTime(ts)}` : formatRelativeTime(ts),
              )
            : null,

          // Error messages from constituent modules
          ...groupModules
            .filter((m) => m.error)
            .map((m) =>
              h("div", {
                key: m.id,
                class: "phase-card__timestamp",
                style: "color: var(--red); margin-top: 4px;",
                title: m.error!,
              }, `${m.name}: ${m.error!.length > 60 ? m.error!.slice(0, 60) + "\u2026" : m.error!}`),
            ),

          // Action buttons
          h("div", { class: "phase-card__actions" },
            h("button", {
              type: "button",
              disabled: anyRunning || !canRun,
              title: anyRunning
                ? "A phase is already running"
                : !canRun
                ? "Requires grouped server endpoints"
                : `Run ${group.name}`,
              onClick: () => handleGroupRun(group),
            }, "Run"),
            hasResetTarget
              ? h("button", {
                  type: "button",
                  disabled: anyRunning || !canRun,
                  title: `Reset ${group.name}`,
                  onClick: () => handleGroupReset(group),
                }, "Reset")
              : null,
          ),
        );
      }),
    ),
  );
}
