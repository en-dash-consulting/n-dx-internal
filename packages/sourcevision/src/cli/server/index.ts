/**
 * Web server for the n-dx dashboard.
 *
 * Serves the sourcevision viewer, provides REST API endpoints for
 * both Rex (PRD data) and sourcevision (analysis data), and supports
 * WebSocket connections for real-time updates.
 *
 * Architecture:
 *   Static assets   → routes-static.ts
 *   /data/*          → routes-data.ts    (sourcevision data files, live-reload)
 *   /api/rex/*       → routes-rex.ts     (PRD CRUD, stats, next task, log)
 *   /api/sv/*        → routes-sourcevision.ts (analysis data endpoints)
 *   WebSocket        → websocket.ts      (upgrade handler, broadcast)
 */

export { startServer } from "./start.js";
export type { ServerOptions } from "./start.js";
export type { ServerContext, RouteHandler } from "./types.js";
export type { WebSocketBroadcaster } from "./websocket.js";
