/**
 * Hook for lazily loading zone convergence history data.
 *
 * Fetches /data/zone-history after initial render to avoid blocking
 * the Zones view. Returns per-zone time series for sparklines.
 */

import { useState, useEffect } from "preact/hooks";

/** A single data point in the time-series. */
export interface ZoneHistoryPoint {
  timestamp: string;
  cohesion: number;
  coupling: number;
  riskScore: number;
  fileCount: number;
  gitSha?: string;
}

/** Per-zone time series with trend direction. */
export interface ZoneTimeSeries {
  zoneId: string;
  zoneName: string;
  points: ZoneHistoryPoint[];
  trend: "improving" | "degrading" | "stable" | "insufficient";
}

/** Full response from the zone-history endpoint. */
export interface ZoneHistoryData {
  zones: ZoneTimeSeries[];
  snapshotCount: number;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
}

interface UseZoneHistoryResult {
  /** History data, null while loading or on error. */
  data: ZoneHistoryData | null;
  /** Whether the fetch is in progress. */
  loading: boolean;
  /** Error message if fetch failed. */
  error: string | null;
  /** Re-fetch the data. */
  refresh: () => void;
}

/**
 * Lazily fetch zone convergence history after mount.
 *
 * @param limit Maximum number of snapshots to include (default 10).
 * @param enabled Set to false to defer loading.
 */
export function useZoneHistory(limit: number = 10, enabled: boolean = true): UseZoneHistoryResult {
  const [data, setData] = useState<ZoneHistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/data/zone-history?limit=${limit}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: ZoneHistoryData) => {
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load zone history");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [limit, enabled, fetchCount]);

  const refresh = () => setFetchCount((c) => c + 1);

  return { data, loading, error, refresh };
}
