/**
 * CJS require hook for measuring module load times.
 *
 * Inject via:  node --require ./scripts/cli-module-timer.cjs <entry>
 *
 * On process exit, writes the top-N slowest modules to the file path
 * specified by the NDX_MODULE_TIMER_OUT environment variable (as JSON).
 *
 * Works for both CJS and ESM packages: Node.js 22+ can require() ESM
 * files synchronously, so Module._load intercepts all transitive loads
 * even when the entry point is ESM.
 *
 * Output format: Array of [moduleName, totalMs] pairs sorted descending.
 *
 * @module scripts/cli-module-timer
 */

'use strict';

const Module = require('module');
const { performance } = require('perf_hooks');
const fs = require('fs');

/** Accumulated load time per module identifier (ms). */
const timings = new Map();

const _origLoad = Module._load;

Module._load = function ndxTimedLoad(request, parent, isMain) {
  const t0 = performance.now();
  const result = _origLoad.apply(this, arguments);
  const elapsed = performance.now() - t0;
  // Accumulate — the same module may be loaded multiple times before caching
  const prev = timings.get(request) || 0;
  timings.set(request, prev + elapsed);
  return result;
};

process.on('exit', () => {
  const outFile = process.env.NDX_MODULE_TIMER_OUT;
  if (!outFile) return;

  const topN = Number(process.env.NDX_MODULE_TIMER_TOP || '20');
  const sorted = [...timings.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  try {
    fs.writeFileSync(outFile, JSON.stringify(sorted), 'utf8');
  } catch {
    // Non-fatal: if we can't write the timing file just skip it
  }
});
