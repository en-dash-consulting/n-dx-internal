/**
 * Local dev server for the sourcevision viewer.
 *
 * Delegates to the modular server implementation in ./server/.
 * This file is kept as a thin re-export for backward compatibility.
 */

export { startServer } from "./server/index.js";
export type { ServerOptions } from "./server/index.js";
