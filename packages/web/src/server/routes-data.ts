/**
 * Data routes — serves .sourcevision/ data files and live-reload status.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse } from "./types.js";
import { ALL_DATA_FILES, SUPPLEMENTARY_FILES } from "../shared/index.js";
import { prdExists, prdPath } from "./prd-io.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".md": "text/markdown",
  ".txt": "text/plain",
};

export interface DataWatcher {
  fileMtimes: Record<string, number>;
  viewerMtime: number;
  refresh: () => void;
}

/** Create a mtime tracker for live-reload support. */
export function createDataWatcher(ctx: ServerContext, viewerPath?: string): DataWatcher {
  const watcher: DataWatcher = {
    fileMtimes: {},
    viewerMtime: 0,
    refresh() {
      for (const file of ALL_DATA_FILES) {
        const filePath = join(ctx.svDir, file);
        try {
          if (existsSync(filePath)) {
            watcher.fileMtimes[file] = statSync(filePath).mtimeMs;
          }
        } catch {
          // File may be mid-write
        }
      }
      // Track prd.json mtime
      try {
        if (prdExists(ctx.rexDir)) {
          watcher.fileMtimes["prd.json"] = statSync(prdPath(ctx.rexDir)).mtimeMs;
        }
      } catch {
        // ignore
      }
      // Track viewer HTML mtime in dev mode
      if (ctx.dev && viewerPath) {
        try {
          watcher.viewerMtime = statSync(viewerPath).mtimeMs;
        } catch {
          // ignore
        }
      }
    },
  };
  watcher.refresh();
  return watcher;
}

/** Handle data file requests. Returns true if the request was handled. */
export function handleDataRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  watcher: DataWatcher,
): boolean {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (method !== "GET") return false;

  // Status endpoint for live reload polling
  if (url === "/data/status") {
    const status: Record<string, unknown> = { mtimes: watcher.fileMtimes };
    if (ctx.dev) status.viewerMtime = watcher.viewerMtime;
    jsonResponse(res, 200, status);
    return true;
  }

  // List available data files
  if (url === "/data") {
    const files: string[] = [...ALL_DATA_FILES, ...SUPPLEMENTARY_FILES];
    const available: string[] = files.filter((f) => existsSync(join(ctx.svDir, f)));
    if (prdExists(ctx.rexDir)) {
      available.push("prd.json");
    }
    jsonResponse(res, 200, { files: available });
    return true;
  }

  // Zone history time-series endpoint
  if (url === "/data/zone-history" || url.startsWith("/data/zone-history?")) {
    const parsed = new URL(url, "http://localhost");
    const limitParam = parsed.searchParams.get("limit");
    const limit = limitParam ? Math.max(2, Math.min(100, parseInt(limitParam, 10) || 10)) : 10;
    const result = loadZoneHistory(ctx.svDir, limit);
    jsonResponse(res, 200, result);
    return true;
  }

  // Serve individual data files
  if (url.startsWith("/data/")) {
    const dataFile = url.replace("/data/", "");

    // Serve prd.json from .rex/ directory
    if (dataFile === "prd.json") {
      const resolvedPrdPath = prdPath(ctx.rexDir);
      if (prdExists(ctx.rexDir)) {
        const stat = statSync(resolvedPrdPath);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": stat.size,
          "Cache-Control": "no-cache",
        });
        createReadStream(resolvedPrdPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
      return true;
    }

    const filePath = join(ctx.svDir, dataFile);

    // Prevent directory traversal
    if (!filePath.startsWith(ctx.svDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return true;
    }

    if (existsSync(filePath)) {
      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] || "application/octet-stream";
      const stat = statSync(filePath);
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": stat.size,
      });
      createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
    return true;
  }

  return false;
}

// ── Zone history aggregation ─────────────────────────────────────────

/** Snapshot entry within a history file. */
interface HistorySnapshot {
  zoneId: string;
  zoneName: string;
  cohesion: number;
  coupling: number;
  riskScore: number;
  fileCount: number;
  timestamp: string;
  gitSha?: string;
}

/** Single history file schema. */
interface HistoryFile {
  schemaVersion: string;
  snapshots: HistorySnapshot[];
  analyzedAt: string;
  gitSha?: string;
}

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

/** Response shape for /data/zone-history. */
export interface ZoneHistoryResponse {
  zones: ZoneTimeSeries[];
  snapshotCount: number;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
}

/**
 * Load and aggregate history files from .sourcevision/history/ into
 * per-zone time series. Returns the most recent `limit` snapshots.
 */
function loadZoneHistory(svDir: string, limit: number): ZoneHistoryResponse {
  const historyDir = join(svDir, "history");

  if (!existsSync(historyDir)) {
    return { zones: [], snapshotCount: 0, oldestTimestamp: null, newestTimestamp: null };
  }

  // Read and sort history files by filename (ISO timestamp order)
  let files: string[];
  try {
    files = readdirSync(historyDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    return { zones: [], snapshotCount: 0, oldestTimestamp: null, newestTimestamp: null };
  }

  if (files.length === 0) {
    return { zones: [], snapshotCount: 0, oldestTimestamp: null, newestTimestamp: null };
  }

  // Take the most recent `limit` files
  const selected = files.slice(-limit);

  // Aggregate per-zone
  const zoneMap = new Map<string, { zoneName: string; points: ZoneHistoryPoint[] }>();

  for (const file of selected) {
    const filePath = join(historyDir, file);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const data: HistoryFile = JSON.parse(raw);
      if (!data.snapshots || !Array.isArray(data.snapshots)) continue;

      for (const snap of data.snapshots) {
        let entry = zoneMap.get(snap.zoneId);
        if (!entry) {
          entry = { zoneName: snap.zoneName, points: [] };
          zoneMap.set(snap.zoneId, entry);
        }
        entry.points.push({
          timestamp: snap.timestamp,
          cohesion: snap.cohesion,
          coupling: snap.coupling,
          riskScore: snap.riskScore,
          fileCount: snap.fileCount,
          gitSha: snap.gitSha,
        });
      }
    } catch {
      // Skip malformed files
    }
  }

  // Sort points by timestamp and compute trend direction
  const zones: ZoneTimeSeries[] = [];
  for (const [zoneId, { zoneName, points }] of zoneMap) {
    points.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    zones.push({
      zoneId,
      zoneName,
      points,
      trend: computeTrend(points),
    });
  }

  // Sort zones alphabetically for stable output
  zones.sort((a, b) => a.zoneName.localeCompare(b.zoneName));

  const allTimestamps = selected.map((f) => f.replace(/\.json$/, "").replace(/-/g, (m, i) => {
    // Reconstruct ISO timestamp from filename: 2026-03-25T20-12-03-869Z → approximate
    return m;
  }));

  return {
    zones,
    snapshotCount: selected.length,
    oldestTimestamp: zones.length > 0 ? zones[0].points[0]?.timestamp ?? null : null,
    newestTimestamp: zones.length > 0
      ? zones[0].points[zones[0].points.length - 1]?.timestamp ?? null
      : null,
  };
}

/**
 * Compute trend direction from time-series points.
 * Compares the average of the last two points against the first two.
 * "Improving" means cohesion increasing or coupling decreasing.
 */
function computeTrend(points: ZoneHistoryPoint[]): ZoneTimeSeries["trend"] {
  if (points.length < 2) return "insufficient";

  const first = points[0];
  const last = points[points.length - 1];

  // Risk score delta: lower is better
  const riskDelta = last.riskScore - first.riskScore;
  const STABLE_THRESHOLD = 0.02;

  if (Math.abs(riskDelta) <= STABLE_THRESHOLD) return "stable";
  return riskDelta < 0 ? "improving" : "degrading";
}
