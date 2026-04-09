/**
 * CLI cold-start benchmark suite for n-dx.
 *
 * Measures wall-clock startup time for each ndx command and identifies the
 * top import-cost contributors in the module graph.  Results are stored as a
 * baseline JSON file; subsequent runs fail if any command exceeds its baseline
 * p50 by more than 20 %.
 *
 * ## Usage
 *
 *   # Run benchmark and compare against stored baseline (exits non-zero on regression)
 *   node scripts/cli-startup-bench.mjs
 *
 *   # Run benchmark and write / overwrite the baseline file
 *   node scripts/cli-startup-bench.mjs --update-baseline
 *
 *   # Control iteration count (default: 7)
 *   node scripts/cli-startup-bench.mjs --iterations=11
 *
 *   # Print verbose timing for every individual run
 *   node scripts/cli-startup-bench.mjs --verbose
 *
 * ## Exit codes
 *
 *   0  All commands within 120 % of baseline p50 (or no baseline stored yet)
 *   1  One or more commands exceed baseline p50 by > 20 %
 *   2  Script usage / setup error
 *
 * @module scripts/cli-startup-bench
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const CLI_PATH = join(ROOT, 'packages', 'core', 'cli.js');
const HOOK_PATH = join(__dir, 'cli-module-timer.cjs');
const BASELINE_PATH = join(__dir, 'cli-startup-baselines.json');

/** Packages whose public dist files are timed for import-cost profiling. */
const PROFILED_PACKAGES = [
  { name: 'rex', dist: join(ROOT, 'packages', 'rex', 'dist', 'public.js') },
  { name: 'sourcevision', dist: join(ROOT, 'packages', 'sourcevision', 'dist', 'public.js') },
  { name: 'hench', dist: join(ROOT, 'packages', 'hench', 'dist', 'public.js') },
  { name: 'llm-client', dist: join(ROOT, 'packages', 'llm-client', 'dist', 'public.js') },
];

/** Baseline schema version — bump when the format changes incompatibly. */
const SCHEMA_VERSION = 'ndx/cli-startup-bench/v1';

/** Regression threshold: p50 may not exceed baseline p50 by more than this. */
const REGRESSION_THRESHOLD = 0.20; // 20 %

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const UPDATE_BASELINE = argv.includes('--update-baseline');
const VERBOSE = argv.includes('--verbose');
const iterationsFlag = argv.find((a) => a.startsWith('--iterations='));
const ITERATIONS = iterationsFlag ? Math.max(3, parseInt(iterationsFlag.slice('--iterations='.length), 10)) : 7;

// ---------------------------------------------------------------------------
// Fixture management
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory pre-populated with a minimal .rex config.
 * Returns the directory path; caller must clean up with cleanupFixture().
 */
function createRexFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ndx-bench-'));
  mkdirSync(join(dir, '.rex'));
  writeFileSync(
    join(dir, '.rex', 'config.json'),
    JSON.stringify({
      schema: 'rex/v1',
      project: 'bench-project',
      adapter: 'file',
      sourcevision: 'auto',
    }),
  );
  writeFileSync(
    join(dir, '.rex', 'prd.json'),
    JSON.stringify({
      schema: 'rex/v1',
      title: 'Bench Project',
      items: [
        {
          id: 'epic-1',
          level: 'epic',
          title: 'Benchmark Epic',
          status: 'pending',
          priority: 'medium',
          children: [
            {
              id: 'task-1',
              level: 'task',
              title: 'Benchmark Task',
              status: 'pending',
              priority: 'high',
            },
          ],
        },
      ],
    }),
  );
  return dir;
}

function cleanupFixture(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

/**
 * Each entry describes one command to benchmark.
 *
 * @property {string}   id      Unique identifier used as the baseline key
 * @property {string[]} args    CLI arguments (use '<dir>' as a placeholder for the fixture directory)
 * @property {string}   label   Human-readable display name
 * @property {string}   fixture 'none' | 'rex' — which fixture the command requires
 */
const COMMANDS = [
  // --- Orchestrator-only (no subprocess spawn) ----------------------------
  { id: 'version',        label: 'ndx version',              args: ['version'],                         fixture: 'none' },
  { id: 'help',           label: 'ndx help',                 args: ['help'],                            fixture: 'none' },
  { id: 'help-status',    label: 'ndx help status',          args: ['help', 'status'],                  fixture: 'none' },
  { id: 'help-plan',      label: 'ndx help plan',            args: ['help', 'plan'],                    fixture: 'none' },
  { id: 'help-work',      label: 'ndx help work',            args: ['help', 'work'],                    fixture: 'none' },
  { id: 'help-analyze',   label: 'ndx help analyze',         args: ['help', 'analyze'],                 fixture: 'none' },
  { id: 'help-init',      label: 'ndx help init',            args: ['help', 'init'],                    fixture: 'none' },
  { id: 'help-flag',      label: 'ndx --help',               args: ['--help'],                          fixture: 'none' },

  // --- Subprocess-spawning (delegate to rex) ------------------------------
  { id: 'status-json',    label: 'ndx status --format=json', args: ['status', '--format=json', '<dir>'], fixture: 'rex' },
  { id: 'status-text',    label: 'ndx status',               args: ['status', '<dir>'],                  fixture: 'rex' },
  { id: 'next',           label: 'ndx next',                 args: ['next', '<dir>'],                    fixture: 'rex' },
  { id: 'validate',       label: 'ndx validate',             args: ['validate', '<dir>'],                fixture: 'rex' },
  { id: 'usage',          label: 'ndx usage',                args: ['usage', '<dir>'],                   fixture: 'rex' },
  { id: 'health-json',    label: 'ndx health --format=json', args: ['health', '--format=json', '<dir>'], fixture: 'rex' },
];

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

/**
 * Compute the p-th percentile of an already-sorted array.
 * Uses nearest-rank method.
 *
 * @param {number[]} sorted  Values sorted ascending
 * @param {number}   p       Percentile [0, 1]
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor(sorted.length * p), sorted.length - 1);
  return sorted[idx];
}

/**
 * Measure the wall-clock time (ms) to spawn the CLI with the given args.
 * Returns null if the process timed out.
 *
 * @param {string[]} args
 * @returns {number | null}
 */
function measureOne(args) {
  const t0 = performance.now();
  spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 15_000,
  });
  return performance.now() - t0;
}

/**
 * Run a command ITERATIONS times and return p50/p95 (ms).
 *
 * @param {string}   id     Command id (for verbose output)
 * @param {string[]} args   Resolved CLI args (no placeholders)
 * @returns {{ p50: number, p95: number, raw: number[] }}
 */
function measureCommand(id, args) {
  const raw = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const ms = measureOne(args);
    if (ms !== null) raw.push(ms);
    if (VERBOSE) {
      process.stdout.write(`  [${id}] run ${i + 1}/${ITERATIONS}: ${ms !== null ? ms.toFixed(1) + 'ms' : 'timeout'}\n`);
    }
  }
  raw.sort((a, b) => a - b);
  const p50 = percentile(raw, 0.5);
  const p95 = percentile(raw, 0.95);
  return { p50, p95, raw };
}

// ---------------------------------------------------------------------------
// Module import profiling
// ---------------------------------------------------------------------------

/**
 * Load each package dist file with the CJS require hook and collect per-module
 * timing.  Aggregates across all packages and returns the top-N sorted entries.
 *
 * @param {number} topN   How many entries to return (default 10 for storage)
 * @returns {Array<{ module: string, ms: number }>}
 */
function profileModuleImports(topN = 10) {
  const outFile = join(tmpdir(), `ndx-module-timings-${process.pid}.json`);
  /** @type {Map<string, number>} */
  const aggregate = new Map();

  for (const pkg of PROFILED_PACKAGES) {
    if (!existsSync(pkg.dist)) {
      console.warn(`  [module-profiling] skipping ${pkg.name} — dist not found at ${pkg.dist}`);
      continue;
    }

    if (existsSync(outFile)) unlinkSync(outFile);

    const result = spawnSync(
      process.execPath,
      [
        '--require', HOOK_PATH,
        '--eval', `require(${JSON.stringify(pkg.dist)}); process.exit(0)`,
      ],
      {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, NDX_MODULE_TIMER_OUT: outFile, NDX_MODULE_TIMER_TOP: '40' },
        timeout: 30_000,
      },
    );

    if (result.status !== 0) {
      console.warn(`  [module-profiling] ${pkg.name} exited ${result.status}: ${result.stderr.slice(0, 120)}`);
      continue;
    }

    if (!existsSync(outFile)) continue;

    try {
      /** @type {[string, number][]} */
      const entries = JSON.parse(readFileSync(outFile, 'utf8'));
      for (const [mod, ms] of entries) {
        aggregate.set(mod, (aggregate.get(mod) || 0) + ms);
      }
    } catch {
      // Corrupt timing file — skip
    }
  }

  if (existsSync(outFile)) unlinkSync(outFile);

  return [...aggregate.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([module, ms]) => ({
      module: module.replace(ROOT + '/', ''),
      ms: Math.round(ms * 10) / 10,
    }));
}

// ---------------------------------------------------------------------------
// Baseline I/O
// ---------------------------------------------------------------------------

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    if (raw.schemaVersion !== SCHEMA_VERSION) return null;
    return raw;
  } catch {
    return null;
  }
}

function saveBaseline(data) {
  writeFileSync(BASELINE_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function formatMs(ms) {
  return ms.toFixed(1).padStart(7) + ' ms';
}

function printCommandResults(results) {
  const colW = Math.max(...results.map((r) => r.label.length));
  console.log('');
  console.log('Command startup timings:');
  console.log(
    '  ' + 'command'.padEnd(colW) + '  p50      p95      status',
  );
  console.log('  ' + '-'.repeat(colW + 34));
  for (const r of results) {
    const label = r.label.padEnd(colW);
    const status = r.regression
      ? `REGRESSION (+${r.regressionPct.toFixed(0)}% over baseline)`
      : r.baselineP50 !== undefined
        ? `ok  (baseline ${formatMs(r.baselineP50)})`
        : 'ok  (no baseline)';
    console.log(`  ${label}  ${formatMs(r.p50)}  ${formatMs(r.p95)}  ${status}`);
  }
}

function printModuleResults(modules) {
  if (modules.length === 0) return;
  console.log('');
  console.log('Top import-cost contributors:');
  modules.slice(0, 5).forEach((m, i) => {
    console.log(`  ${i + 1}. ${formatMs(m.ms)}  ${m.module}`);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`n-dx CLI cold-start benchmark  (${ITERATIONS} iterations per command)`);
  console.log(`Node: ${process.version}  Platform: ${process.platform}`);
  console.log('');

  const baseline = loadBaseline();
  if (baseline) {
    console.log(`Baseline loaded from ${BASELINE_PATH}`);
    console.log(`  Recorded: ${baseline.recordedAt}  Node: ${baseline.nodeVersion}  Platform: ${baseline.platform}`);
  } else {
    console.log('No baseline found — this run will establish the baseline.');
  }

  // --- Fixture setup -------------------------------------------------------
  let rexFixtureDir = null;
  try {
    rexFixtureDir = createRexFixture();
  } catch (err) {
    console.error('Failed to create fixture directory:', err.message);
    process.exit(2);
  }

  // --- Command benchmarks --------------------------------------------------
  console.log('');
  console.log('Running command benchmarks …');

  const commandResults = [];
  try {
    for (const cmd of COMMANDS) {
      const resolvedArgs = cmd.args.map((a) => (a === '<dir>' ? rexFixtureDir : a));
      process.stdout.write(`  ${cmd.label} …`);
      const { p50, p95, raw } = measureCommand(cmd.id, resolvedArgs);
      process.stdout.write(`  p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms\n`);

      const baselineEntry = baseline?.commands?.[cmd.id];
      const regression =
        baselineEntry !== undefined && p50 > baselineEntry.p50 * (1 + REGRESSION_THRESHOLD);
      const regressionPct = baselineEntry
        ? ((p50 - baselineEntry.p50) / baselineEntry.p50) * 100
        : 0;

      commandResults.push({
        id: cmd.id,
        label: cmd.label,
        p50,
        p95,
        raw,
        baselineP50: baselineEntry?.p50,
        regression,
        regressionPct,
      });
    }
  } finally {
    cleanupFixture(rexFixtureDir);
  }

  // --- Module profiling ----------------------------------------------------
  console.log('');
  console.log('Profiling module import costs …');
  const moduleImportCosts = profileModuleImports(10);
  if (moduleImportCosts.length === 0) {
    console.warn('  No module timing data collected — dist files may need to be built first.');
    console.warn('  Run: pnpm build');
  }

  // --- Print results -------------------------------------------------------
  printCommandResults(commandResults);
  printModuleResults(moduleImportCosts);

  // --- Regressions ---------------------------------------------------------
  const regressions = commandResults.filter((r) => r.regression);

  if (regressions.length > 0) {
    console.log('');
    console.log('REGRESSIONS DETECTED:');
    for (const r of regressions) {
      console.log(
        `  ${r.label}: p50=${r.p50.toFixed(1)}ms exceeds baseline ${r.baselineP50.toFixed(1)}ms by ${r.regressionPct.toFixed(1)}% (threshold: ${(REGRESSION_THRESHOLD * 100).toFixed(0)}%)`,
      );
    }
  }

  // --- Baseline write ------------------------------------------------------
  if (UPDATE_BASELINE || !baseline) {
    const newBaseline = {
      schemaVersion: SCHEMA_VERSION,
      recordedAt: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      iterations: ITERATIONS,
      regressionThreshold: REGRESSION_THRESHOLD,
      commands: Object.fromEntries(
        commandResults.map((r) => [
          r.id,
          {
            label: r.label,
            p50: Math.round(r.p50 * 10) / 10,
            p95: Math.round(r.p95 * 10) / 10,
          },
        ]),
      ),
      moduleImportCosts,
    };
    saveBaseline(newBaseline);
    console.log('');
    console.log(`Baseline ${UPDATE_BASELINE ? 'updated' : 'written'} → ${BASELINE_PATH}`);
  }

  // --- Exit code -----------------------------------------------------------
  if (regressions.length > 0) {
    console.log('');
    console.log(`Benchmark failed: ${regressions.length} regression(s) detected.`);
    process.exit(1);
  }

  console.log('');
  console.log('All commands within threshold. Benchmark passed.');
}

// Run only when executed directly (not when imported as a module).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Benchmark error:', err.message);
    process.exit(2);
  });
}

export { main, COMMANDS, REGRESSION_THRESHOLD, SCHEMA_VERSION, profileModuleImports };
