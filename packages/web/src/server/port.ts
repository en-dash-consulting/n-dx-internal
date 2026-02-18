/**
 * Port availability detection and dynamic allocation.
 *
 * Provides utilities for checking whether a TCP port is available and
 * finding the next available port within a configurable range.
 *
 * Used by the server startup code to gracefully fall back when the
 * configured port (default 3117) is already occupied.
 */

import { createServer, createConnection } from "node:net";

/** Default port range for fallback allocation. */
export const DEFAULT_PORT = 3117;
export const PORT_RANGE_START = 3117;
export const PORT_RANGE_END = 3200;

export interface PortCheckResult {
  /** Whether the requested port is available. */
  available: boolean;
  /** The port that was checked. */
  port: number;
  /** Error details if the port is unavailable (e.g. "EADDRINUSE", "EACCES"). */
  error?: string;
}

export interface PortAllocationResult {
  /** The port that is available and should be used. */
  port: number;
  /** Whether this is the originally requested port (true) or a fallback (false). */
  isOriginal: boolean;
  /** The originally requested port. */
  requestedPort: number;
}

/**
 * Check if a specific port is available for binding.
 *
 * Uses a two-phase approach:
 * 1. Try to connect — if something is already listening, report unavailable.
 * 2. If nothing is listening, try to bind — catches EACCES and other bind errors.
 *
 * This avoids SO_REUSEADDR false positives where a bind-only check might
 * succeed even though the port is already occupied by another process.
 */
export function checkPort(port: number): Promise<PortCheckResult> {
  return new Promise((resolve) => {
    // Phase 1: try to connect — detects if a server is already listening
    const sock = createConnection({ port, host: "127.0.0.1" });
    sock.once("connect", () => {
      sock.destroy();
      resolve({ available: false, port, error: "EADDRINUSE" });
    });
    sock.once("error", (connErr: NodeJS.ErrnoException) => {
      sock.destroy();
      if (connErr.code === "ECONNREFUSED") {
        // Nothing listening — phase 2: try to bind to catch permission errors
        const server = createServer();
        server.once("error", (err: NodeJS.ErrnoException) => {
          resolve({ available: false, port, error: err.code ?? err.message });
        });
        server.listen(port, () => {
          server.close(() => {
            resolve({ available: true, port });
          });
        });
      } else {
        // Other connection error (e.g., timeout) — treat as unavailable
        resolve({ available: false, port, error: connErr.code ?? connErr.message });
      }
    });
  });
}

/**
 * Find the next available port in a range.
 *
 * Tries the `preferred` port first, then scans sequentially from
 * `rangeStart` to `rangeEnd` (inclusive). Skips the preferred port
 * during the scan since it was already tried.
 *
 * @throws {Error} If no port is available in the entire range.
 */
export async function findAvailablePort(
  preferred: number,
  rangeStart: number = PORT_RANGE_START,
  rangeEnd: number = PORT_RANGE_END,
): Promise<PortAllocationResult> {
  // Try the preferred port first
  const check = await checkPort(preferred);

  if (check.available) {
    return { port: preferred, isOriginal: true, requestedPort: preferred };
  }

  // If the error is a permission issue, don't try other ports in the same range
  // — the user likely needs elevated privileges
  if (check.error === "EACCES") {
    throw new Error(
      `Permission denied for port ${preferred}. ` +
      `Try a port above 1024 or run with elevated privileges.`,
    );
  }

  // Scan the range for an available port
  for (let p = rangeStart; p <= rangeEnd; p++) {
    if (p === preferred) continue; // already tried

    const result = await checkPort(p);
    if (result.available) {
      return { port: p, isOriginal: false, requestedPort: preferred };
    }
  }

  throw new Error(
    `No available port found in range ${rangeStart}–${rangeEnd}. ` +
    `All ports are in use.`,
  );
}
