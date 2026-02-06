/**
 * Rex API routes — CRUD for PRD items, tree stats, next task, and log entries.
 *
 * All endpoints are under /api/rex/.
 *
 * GET  /api/rex/prd              — full PRD document
 * GET  /api/rex/stats            — tree stats (total, completed, etc.)
 * GET  /api/rex/next             — next actionable task
 * GET  /api/rex/items/:id        — single item by ID
 * PATCH /api/rex/items/:id       — update item fields
 * GET  /api/rex/log              — execution log (?limit=N)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./types.js";
import type { WebSocketBroadcaster } from "./websocket.js";

const REX_PREFIX = "/api/rex/";

interface PRDItemRecord {
  id: string;
  status: string;
  level: string;
  title: string;
  children?: PRDItemRecord[];
  [key: string]: unknown;
}

interface PRDDocRecord {
  schema: string;
  title: string;
  items: PRDItemRecord[];
  [key: string]: unknown;
}

/** Walk the tree to find an item by ID. */
function findItemById(items: PRDItemRecord[], id: string): PRDItemRecord | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (Array.isArray(item.children)) {
      const found = findItemById(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Walk the tree to update an item in place. */
function updateInTree(
  items: PRDItemRecord[],
  id: string,
  updates: Record<string, unknown>,
): boolean {
  for (const item of items) {
    if (item.id === id) {
      // Apply auto-timestamps for status changes
      if (updates.status === "in_progress" && item.status !== "in_progress") {
        updates.startedAt = updates.startedAt || new Date().toISOString();
      }
      if (updates.status === "completed" && item.status !== "completed") {
        updates.completedAt = updates.completedAt || new Date().toISOString();
      }
      Object.assign(item, updates);
      return true;
    }
    if (Array.isArray(item.children) && updateInTree(item.children, id, updates)) {
      return true;
    }
  }
  return false;
}

interface TreeStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  deferred: number;
  blocked: number;
}

/** Compute stats counting only task and subtask levels. */
function computeStats(items: PRDItemRecord[]): TreeStats {
  const stats: TreeStats = {
    total: 0,
    completed: 0,
    inProgress: 0,
    pending: 0,
    deferred: 0,
    blocked: 0,
  };

  function walk(list: PRDItemRecord[]): void {
    for (const item of list) {
      if (item.level === "task" || item.level === "subtask") {
        stats.total++;
        switch (item.status) {
          case "completed": stats.completed++; break;
          case "in_progress": stats.inProgress++; break;
          case "pending": stats.pending++; break;
          case "deferred": stats.deferred++; break;
          case "blocked": stats.blocked++; break;
        }
      }
      if (Array.isArray(item.children)) walk(item.children);
    }
  }

  walk(items);
  return stats;
}

/** Find the next actionable task (pending/in_progress leaf with resolved deps). */
function findNextTask(items: PRDItemRecord[], completedIds: Set<string>): PRDItemRecord | null {
  const PRIORITY_ORDER: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  interface Candidate {
    item: PRDItemRecord;
    priority: number;
  }

  const candidates: Candidate[] = [];

  function collect(list: PRDItemRecord[]): void {
    for (const item of list) {
      if (item.status === "completed" || item.status === "deferred" || item.status === "blocked") continue;

      // Check unresolved dependencies
      if (Array.isArray(item.blockedBy) && item.blockedBy.length > 0) {
        if (!(item.blockedBy as string[]).every((dep) => completedIds.has(dep))) continue;
      }

      if (Array.isArray(item.children) && item.children.length > 0) {
        collect(item.children);
        const allChildrenDone = item.children.every(
          (c) => c.status === "completed" || c.status === "deferred",
        );
        if (allChildrenDone) {
          candidates.push({
            item,
            priority: PRIORITY_ORDER[(item.priority as string) ?? "medium"] ?? 2,
          });
        }
      } else {
        candidates.push({
          item,
          priority: PRIORITY_ORDER[(item.priority as string) ?? "medium"] ?? 2,
        });
      }
    }
  }

  collect(items);

  if (candidates.length === 0) return null;

  // Sort: in_progress first, then by priority
  candidates.sort((a, b) => {
    const aInProg = a.item.status === "in_progress" ? 0 : 1;
    const bInProg = b.item.status === "in_progress" ? 0 : 1;
    if (aInProg !== bInProg) return aInProg - bInProg;
    return a.priority - b.priority;
  });

  return candidates[0].item;
}

/** Collect IDs of all completed items. */
function collectCompletedIds(items: PRDItemRecord[]): Set<string> {
  const ids = new Set<string>();
  function walk(list: PRDItemRecord[]): void {
    for (const item of list) {
      if (item.status === "completed") ids.add(item.id);
      if (Array.isArray(item.children)) walk(item.children);
    }
  }
  walk(items);
  return ids;
}

/** Load and parse prd.json. Returns null if not found. */
function loadPRD(ctx: ServerContext): PRDDocRecord | null {
  const prdPath = join(ctx.rexDir, "prd.json");
  if (!existsSync(prdPath)) return null;
  try {
    return JSON.parse(readFileSync(prdPath, "utf-8")) as PRDDocRecord;
  } catch {
    return null;
  }
}

/** Save prd.json. */
function savePRD(ctx: ServerContext, doc: PRDDocRecord): void {
  const prdPath = join(ctx.rexDir, "prd.json");
  writeFileSync(prdPath, JSON.stringify(doc, null, 2) + "\n");
}

/** Handle Rex API requests. Returns true if the request was handled. */
export function handleRexRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (!url.startsWith(REX_PREFIX)) return false;

  const fullPath = url.slice(REX_PREFIX.length);
  const qIdx = fullPath.indexOf("?");
  const path = qIdx === -1 ? fullPath : fullPath.slice(0, qIdx);

  // GET /api/rex/prd — full PRD document
  if (path === "prd" && method === "GET") {
    const doc = loadPRD(ctx);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }
    jsonResponse(res, 200, doc);
    return true;
  }

  // GET /api/rex/stats — tree stats
  if (path === "stats" && method === "GET") {
    const doc = loadPRD(ctx);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }
    const stats = computeStats(doc.items);
    jsonResponse(res, 200, {
      title: doc.title,
      stats,
      percentComplete: stats.total > 0
        ? Math.round((stats.completed / stats.total) * 100)
        : 0,
    });
    return true;
  }

  // GET /api/rex/next — next actionable task
  if (path === "next" && method === "GET") {
    const doc = loadPRD(ctx);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }
    const completedIds = collectCompletedIds(doc.items);
    const next = findNextTask(doc.items, completedIds);
    if (!next) {
      jsonResponse(res, 200, { task: null, message: "All tasks completed or blocked" });
      return true;
    }
    jsonResponse(res, 200, { task: next });
    return true;
  }

  // GET /api/rex/log — execution log
  if (path === "log" && method === "GET") {
    const logPath = join(ctx.rexDir, "execution-log.jsonl");
    if (!existsSync(logPath)) {
      jsonResponse(res, 200, { entries: [] });
      return true;
    }
    try {
      const raw = readFileSync(logPath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);

      // Parse limit from query string
      const queryIdx = url.indexOf("?");
      let limit = 0;
      if (queryIdx !== -1) {
        const params = new URLSearchParams(url.slice(queryIdx));
        const limitStr = params.get("limit");
        if (limitStr) limit = parseInt(limitStr, 10);
      }

      const entries = lines
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);

      const result = limit > 0 ? entries.slice(-limit) : entries;
      jsonResponse(res, 200, { entries: result });
    } catch {
      jsonResponse(res, 200, { entries: [] });
    }
    return true;
  }

  // Routes under /api/rex/items/:id
  const itemsMatch = path.match(/^items\/([^/?]+)/);
  if (itemsMatch) {
    const itemId = itemsMatch[1];

    // GET /api/rex/items/:id — single item
    if (method === "GET") {
      const doc = loadPRD(ctx);
      if (!doc) {
        errorResponse(res, 404, "No PRD data found");
        return true;
      }
      const item = findItemById(doc.items, itemId);
      if (!item) {
        errorResponse(res, 404, `Item "${itemId}" not found`);
        return true;
      }
      jsonResponse(res, 200, item);
      return true;
    }

    // PATCH /api/rex/items/:id — update item
    if (method === "PATCH") {
      return handleItemPatch(req, res, ctx, itemId, broadcast);
    }
  }

  return false;
}

/** Handle PATCH /api/rex/items/:id */
async function handleItemPatch(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  itemId: string,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  try {
    const body = await readBody(req);
    const updates = JSON.parse(body);

    if (!updateInTree(doc.items, itemId, updates)) {
      errorResponse(res, 404, `Item "${itemId}" not found`);
      return true;
    }

    savePRD(ctx, doc);

    // Broadcast change to connected WebSocket clients
    if (broadcast) {
      broadcast({
        type: "rex:item-updated",
        itemId,
        updates,
        timestamp: new Date().toISOString(),
      });
    }

    jsonResponse(res, 200, { ok: true });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}
