import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse CLI args (pass-through --port, --scope, directory)
const cliArgs = process.argv.slice(2);
let port = 3117;
let scope;
let targetDir = ".";

for (const a of cliArgs) {
  if (a.startsWith("--port=")) {
    port = parseInt(a.split("=")[1], 10);
  } else if (a.startsWith("--scope=")) {
    scope = a.split("=")[1];
  } else if (!a.startsWith("-")) {
    targetDir = a;
  }
}

const children = [];

function run(label, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  children.push(child);

  const prefix = `[${label}]`;
  child.stdout.on("data", (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      console.log(`${prefix} ${line}`);
    }
  });
  child.stderr.on("data", (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      console.error(`${prefix} ${line}`);
    }
  });
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`${prefix} exited with code ${code}`);
    }
  });
  return child;
}

// Start TypeScript watcher
run("tsc", "npx", ["tsc", "--watch", "--preserveWatchOutput"]);

// Start esbuild viewer watcher
run("esbuild", "node", ["build.js", "--watch"]);

/**
 * Wait for the dist/ artifacts to exist before starting the server.
 * Polls every 500ms instead of a fixed timeout — handles both fast
 * and slow machines without wasting time or starting too early.
 */
const requiredFiles = [
  resolve(__dirname, "dist/server/start.js"),
  resolve(__dirname, "dist/viewer/index.html"),
];

function allFilesReady() {
  return requiredFiles.every((f) => existsSync(f));
}

const MAX_WAIT = 30000;
const POLL_INTERVAL = 500;
let waited = 0;

const readyCheck = setInterval(() => {
  waited += POLL_INTERVAL;
  if (allFilesReady()) {
    clearInterval(readyCheck);
    startDevServer();
  } else if (waited >= MAX_WAIT) {
    clearInterval(readyCheck);
    console.error("[dev] Timed out waiting for dist/ artifacts. Check build output above.");
    cleanup();
  }
}, POLL_INTERVAL);

// If files are already built (e.g. running dev a second time), start immediately
if (allFilesReady()) {
  clearInterval(readyCheck);
  // Small delay to let tsc pick up its watcher before we load the module
  setTimeout(startDevServer, 200);
}

function startDevServer() {
  const serveArgs = [`--port=${port}`];
  if (scope) serveArgs.push(`--scope=${scope}`);

  const importExpr = [
    `import("./dist/server/start.js")`,
    `.then(m => m.startServer(${JSON.stringify(targetDir)}, ${port}, { dev: true${scope ? `, scope: ${JSON.stringify(scope)}` : ""} }))`,
    `.catch(e => { console.error(e); process.exit(1); });`,
  ].join("");

  run("serve", "node", ["--input-type=module", "-e", importExpr]);
}

// Clean up all children on exit
function cleanup() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
