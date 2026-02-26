/**
 * Cross-platform system memory monitoring for pre-spawn checks.
 *
 * Provides real-time memory usage detection across macOS, Linux, and Windows
 * by using platform-specific APIs when available and falling back to
 * `os.freemem()`/`os.totalmem()` as a baseline.
 *
 * Key differences from {@link MemoryThrottle}:
 * - **MemoryThrottle** is the entry-gate decision engine (delay/reject at run start)
 * - **SystemMemoryMonitor** provides accurate cross-platform memory readings
 *   and a lightweight pre-spawn check for the tool dispatch path
 *
 * Integration points:
 * - Implements `SystemMemoryReader` for use as a `MemoryThrottle` backend
 * - Standalone `checkBeforeSpawn()` for per-tool-call memory gating
 * - `snapshot()` for API/dashboard exposure
 *
 * Platform behavior:
 * - **Linux**: reads `/proc/meminfo` for `MemAvailable` (accounts for
 *   page cache and reclaimable slab memory the kernel can reclaim)
 * - **macOS**: uses `os.freemem()` (Darwin's `vm_stat` free pages)
 * - **Windows**: uses `os.freemem()` (Win32 `GlobalMemoryStatusEx`)
 *
 * @module hench/process/memory-monitor
 */

import { freemem, totalmem, platform } from "node:os";
import { readFile } from "node:fs/promises";
import type { SystemMemoryReader } from "./memory-throttle.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default memory usage percentage that blocks process spawning. */
const DEFAULT_SPAWN_THRESHOLD = 90;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the system memory monitor.
 */
export interface MemoryMonitorConfig {
  /** Enable pre-spawn memory checks. When false, all checks are bypassed. */
  enabled: boolean;
  /** Memory usage percentage above which spawning is blocked (0–100). */
  spawnThreshold: number;
}

/** Default memory monitor configuration. */
export const DEFAULT_MEMORY_MONITOR_CONFIG: MemoryMonitorConfig = {
  enabled: true,
  spawnThreshold: DEFAULT_SPAWN_THRESHOLD,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Detailed cross-platform memory snapshot.
 * Suitable for JSON serialization and API/dashboard exposure.
 */
export interface SystemMemorySnapshot {
  /** Operating system platform. */
  platform: NodeJS.Platform;
  /** Total system memory in bytes. */
  totalBytes: number;
  /** Free memory in bytes (OS-reported, does not account for cache). */
  freeBytes: number;
  /**
   * Available memory in bytes.
   * On Linux, this is `MemAvailable` from `/proc/meminfo` (accounts for
   * buffers/cache). On other platforms, falls back to `freeBytes`.
   */
  availableBytes: number;
  /** Memory usage as a percentage (0–100), based on available memory. */
  usagePercent: number;
  /** Total memory in MB. */
  totalMB: number;
  /** Free memory in MB. */
  freeMB: number;
  /** Available memory in MB. */
  availableMB: number;
  /** ISO timestamp of this snapshot. */
  timestamp: string;
}

/**
 * Result of a pre-spawn memory check.
 */
export interface SpawnMemoryCheck {
  /** Whether spawning is allowed. */
  allowed: boolean;
  /** Current memory usage percentage. */
  usagePercent: number;
  /** Configured spawn threshold. */
  spawnThreshold: number;
  /** Available memory in MB. */
  availableMB: number;
  /** Total memory in MB. */
  totalMB: number;
  /** Human-readable reason when blocked. Undefined when allowed. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Platform-specific memory readers
// ---------------------------------------------------------------------------

/**
 * Parse Linux `/proc/meminfo` for `MemAvailable`.
 *
 * `MemAvailable` is more accurate than `MemFree` because it accounts for
 * page cache and reclaimable slab memory that the kernel can reclaim
 * under memory pressure. Available since Linux 3.14 (2014).
 *
 * @returns Available memory in bytes, or `undefined` if not readable.
 */
async function readLinuxAvailableMemory(): Promise<number | undefined> {
  try {
    const content = await readFile("/proc/meminfo", "utf-8");
    const match = content.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    if (match) {
      return parseInt(match[1]!, 10) * 1024; // kB → bytes
    }
  } catch {
    // /proc/meminfo not available — fall back to os.freemem()
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Injectable overrides (for testing)
// ---------------------------------------------------------------------------

/**
 * Optional overrides for deterministic testing.
 * When provided, these replace the real OS and filesystem calls.
 */
export interface MemoryMonitorOverrides {
  /** Override detected platform. */
  platform?: NodeJS.Platform;
  /** Override `os.freemem()`. */
  freemem?: () => number;
  /** Override `os.totalmem()`. */
  totalmem?: () => number;
  /** Override Linux `/proc/meminfo` reader. */
  readLinuxAvailable?: () => Promise<number | undefined>;
}

// ---------------------------------------------------------------------------
// SystemMemoryMonitor
// ---------------------------------------------------------------------------

/**
 * Cross-platform system memory monitor.
 *
 * Provides accurate memory readings and a pre-spawn check that can be
 * called before every child process creation in the tool dispatch path.
 *
 * Implements {@link SystemMemoryReader} so it can also serve as the
 * backend for {@link MemoryThrottle}, ensuring consistent memory readings
 * across both the entry-gate check and per-spawn checks.
 *
 * @example
 * ```ts
 * const monitor = new SystemMemoryMonitor({ spawnThreshold: 85 });
 *
 * // Quick pre-spawn check
 * const check = await monitor.checkBeforeSpawn();
 * if (!check.allowed) {
 *   console.warn(`Spawn blocked: ${check.reason}`);
 * }
 *
 * // Full snapshot for dashboard/API
 * const snap = await monitor.snapshot();
 * console.log(`Memory: ${snap.usagePercent}% used`);
 *
 * // As SystemMemoryReader for MemoryThrottle
 * const throttle = new MemoryThrottle(throttleConfig, monitor);
 * ```
 */
export class SystemMemoryMonitor implements SystemMemoryReader {
  private readonly _config: MemoryMonitorConfig;
  private readonly _platform: NodeJS.Platform;
  private readonly _freemem: () => number;
  private readonly _totalmem: () => number;
  private readonly _readLinuxAvailable: () => Promise<number | undefined>;

  constructor(
    config?: Partial<MemoryMonitorConfig>,
    overrides?: MemoryMonitorOverrides,
  ) {
    this._config = { ...DEFAULT_MEMORY_MONITOR_CONFIG, ...config };
    this._platform = overrides?.platform ?? platform();
    this._freemem = overrides?.freemem ?? freemem;
    this._totalmem = overrides?.totalmem ?? totalmem;
    this._readLinuxAvailable = overrides?.readLinuxAvailable ?? readLinuxAvailableMemory;

    // Validate threshold
    if (this._config.spawnThreshold < 0 || this._config.spawnThreshold > 100) {
      throw new RangeError("SystemMemoryMonitor spawnThreshold must be between 0 and 100");
    }
  }

  /** Current configuration (read-only copy). */
  get config(): Readonly<MemoryMonitorConfig> {
    return { ...this._config };
  }

  /** Detected platform. */
  get detectedPlatform(): NodeJS.Platform {
    return this._platform;
  }

  // -----------------------------------------------------------------------
  // SystemMemoryReader implementation (for MemoryThrottle compatibility)
  // -----------------------------------------------------------------------

  /** Free system memory in bytes. Synchronous (uses OS module). */
  freemem(): number {
    return this._freemem();
  }

  /** Total system memory in bytes. */
  totalmem(): number {
    return this._totalmem();
  }

  // -----------------------------------------------------------------------
  // Snapshot
  // -----------------------------------------------------------------------

  /**
   * Take a detailed cross-platform memory snapshot.
   *
   * On Linux, reads `/proc/meminfo` for accurate available memory.
   * On other platforms, falls back to `os.freemem()`.
   */
  async snapshot(): Promise<SystemMemorySnapshot> {
    const totalBytes = this._totalmem();
    const freeBytes = this._freemem();

    // Try platform-specific available memory
    let availableBytes = freeBytes;
    if (this._platform === "linux") {
      const linuxAvailable = await this._readLinuxAvailable();
      if (linuxAvailable !== undefined) {
        availableBytes = linuxAvailable;
      }
    }

    const toMB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;
    const usagePercent = totalBytes > 0
      ? Math.round(((totalBytes - availableBytes) / totalBytes) * 10000) / 100
      : 0;

    return {
      platform: this._platform,
      totalBytes,
      freeBytes,
      availableBytes,
      usagePercent,
      totalMB: toMB(totalBytes),
      freeMB: toMB(freeBytes),
      availableMB: toMB(availableBytes),
      timestamp: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Pre-spawn check
  // -----------------------------------------------------------------------

  /**
   * Check whether system memory allows spawning a new child process.
   *
   * This is the primary integration point for the tool dispatch path.
   * Called before every process-spawning tool (`run_command`, `git`)
   * to prevent system-wide memory pressure.
   *
   * When disabled (via config), always returns `{ allowed: true }`.
   *
   * @returns Structured result with the decision and current memory state.
   */
  async checkBeforeSpawn(): Promise<SpawnMemoryCheck> {
    if (!this._config.enabled) {
      const snap = await this.snapshot();
      return {
        allowed: true,
        usagePercent: snap.usagePercent,
        spawnThreshold: this._config.spawnThreshold,
        availableMB: snap.availableMB,
        totalMB: snap.totalMB,
      };
    }

    const snap = await this.snapshot();
    const allowed = snap.usagePercent < this._config.spawnThreshold;

    return {
      allowed,
      usagePercent: snap.usagePercent,
      spawnThreshold: this._config.spawnThreshold,
      availableMB: snap.availableMB,
      totalMB: snap.totalMB,
      reason: allowed
        ? undefined
        : `System memory usage (${snap.usagePercent.toFixed(1)}%) exceeds spawn threshold ` +
          `(${this._config.spawnThreshold}%). ` +
          `Available: ${snap.availableMB.toFixed(0)}MB / ${snap.totalMB.toFixed(0)}MB total. ` +
          `Close other applications to free memory, or adjust the threshold with: ` +
          `hench config guard.memoryMonitor.spawnThreshold <number>`,
    };
  }
}
