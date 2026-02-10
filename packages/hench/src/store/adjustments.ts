/**
 * Adaptive adjustment persistence — stores adjustment history, settings,
 * and override state for the adaptive workflow system.
 *
 * State is stored in `.hench/adaptive.json`.
 */

import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { AdaptiveSettings, WorkflowAdjustment, AdjustmentNotification } from "../agent/analysis/adaptive.js";
import { DEFAULT_ADAPTIVE_SETTINGS } from "../agent/analysis/adaptive.js";

// ── Types ────────────────────────────────────────────────────────────

export type AdjustmentDecision = "applied" | "dismissed" | "overridden";

export interface AdjustmentRecord {
  /** The adjustment ID (matches WorkflowAdjustment.id). */
  adjustmentId: string;
  /** Short title for human reference. */
  title: string;
  /** Category of the adjustment. */
  category: string;
  /** The config key that was adjusted. */
  configKey: string;
  /** What happened. */
  decision: AdjustmentDecision;
  /** Value before adjustment (if applied). */
  previousValue?: unknown;
  /** Value after adjustment (if applied). */
  newValue?: unknown;
  /** Whether this was automatic or user-initiated. */
  automatic: boolean;
  /** ISO timestamp. */
  timestamp: string;
}

export interface AdaptiveState {
  settings: AdaptiveSettings;
  history: AdjustmentRecord[];
  /** Manual overrides: config key → value locked by user. */
  overrides: Record<string, unknown>;
}

const ADAPTIVE_FILE = "adaptive.json";

function filePath(henchDir: string): string {
  return join(henchDir, ADAPTIVE_FILE);
}

function defaultState(): AdaptiveState {
  return {
    settings: DEFAULT_ADAPTIVE_SETTINGS(),
    history: [],
    overrides: {},
  };
}

// ── Load / Save ──────────────────────────────────────────────────────

/** Load adaptive state from disk (sync). Returns defaults if missing. */
export function loadAdaptiveState(henchDir: string): AdaptiveState {
  const path = filePath(henchDir);
  try {
    if (!existsSync(path)) return defaultState();
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return mergeWithDefaults(parsed);
  } catch {
    return defaultState();
  }
}

/** Load adaptive state from disk (async). Returns defaults if missing. */
export async function loadAdaptiveStateAsync(henchDir: string): Promise<AdaptiveState> {
  const path = filePath(henchDir);
  try {
    if (!existsSync(path)) return defaultState();
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return mergeWithDefaults(parsed);
  } catch {
    return defaultState();
  }
}

/** Save adaptive state to disk (sync). */
export function saveAdaptiveState(henchDir: string, state: AdaptiveState): void {
  writeFileSync(filePath(henchDir), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/** Save adaptive state to disk (async). */
export async function saveAdaptiveStateAsync(
  henchDir: string,
  state: AdaptiveState,
): Promise<void> {
  await writeFile(filePath(henchDir), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

// ── Operations ───────────────────────────────────────────────────────

/** Record an adjustment decision. */
export function recordAdjustment(
  henchDir: string,
  record: AdjustmentRecord,
): void {
  const state = loadAdaptiveState(henchDir);
  state.history.push(record);
  saveAdaptiveState(henchDir, state);
}

/** Update adaptive settings. */
export function updateSettings(
  henchDir: string,
  updates: Partial<AdaptiveSettings>,
): AdaptiveSettings {
  const state = loadAdaptiveState(henchDir);
  state.settings = { ...state.settings, ...updates };
  saveAdaptiveState(henchDir, state);
  return state.settings;
}

/** Lock a config key from automatic adjustment. */
export function lockKey(henchDir: string, key: string): void {
  const state = loadAdaptiveState(henchDir);
  if (!state.settings.lockedKeys.includes(key)) {
    state.settings.lockedKeys.push(key);
  }
  saveAdaptiveState(henchDir, state);
}

/** Unlock a config key for automatic adjustment. */
export function unlockKey(henchDir: string, key: string): void {
  const state = loadAdaptiveState(henchDir);
  state.settings.lockedKeys = state.settings.lockedKeys.filter((k) => k !== key);
  saveAdaptiveState(henchDir, state);
}

/** Set a manual override for a config key. */
export function setOverride(henchDir: string, key: string, value: unknown): void {
  const state = loadAdaptiveState(henchDir);
  state.overrides[key] = value;
  if (!state.settings.lockedKeys.includes(key)) {
    state.settings.lockedKeys.push(key);
  }
  saveAdaptiveState(henchDir, state);
}

/** Remove a manual override. */
export function removeOverride(henchDir: string, key: string): void {
  const state = loadAdaptiveState(henchDir);
  delete state.overrides[key];
  state.settings.lockedKeys = state.settings.lockedKeys.filter((k) => k !== key);
  saveAdaptiveState(henchDir, state);
}

/** Get summary statistics from adjustment history. */
export function getAdjustmentStats(state: AdaptiveState): {
  total: number;
  applied: number;
  dismissed: number;
  overridden: number;
  automatic: number;
  manual: number;
  byCategory: Record<string, { applied: number; dismissed: number; overridden: number }>;
} {
  const { history } = state;
  const total = history.length;
  const applied = history.filter((r) => r.decision === "applied").length;
  const dismissed = history.filter((r) => r.decision === "dismissed").length;
  const overridden = history.filter((r) => r.decision === "overridden").length;
  const automatic = history.filter((r) => r.automatic).length;
  const manual = total - automatic;

  const byCategory: Record<string, { applied: number; dismissed: number; overridden: number }> = {};
  for (const record of history) {
    const cat = byCategory[record.category] ?? { applied: 0, dismissed: 0, overridden: 0 };
    cat[record.decision]++;
    byCategory[record.category] = cat;
  }

  return { total, applied, dismissed, overridden, automatic, manual, byCategory };
}

// ── Helpers ──────────────────────────────────────────────────────────

function mergeWithDefaults(parsed: unknown): AdaptiveState {
  if (!parsed || typeof parsed !== "object") return defaultState();
  const obj = parsed as Record<string, unknown>;
  const defaults = defaultState();

  return {
    settings: {
      ...defaults.settings,
      ...(obj.settings && typeof obj.settings === "object" ? obj.settings as Partial<AdaptiveSettings> : {}),
    },
    history: Array.isArray(obj.history) ? obj.history as AdjustmentRecord[] : [],
    overrides: (obj.overrides && typeof obj.overrides === "object" ? obj.overrides : {}) as Record<string, unknown>,
  };
}
