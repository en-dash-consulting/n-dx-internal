# Timeout Audit — Universal Timeout Editability

Inventories every hardcoded timeout across `core`, `rex`, `hench`, `sourcevision`, `llm-client`, and `web` production sources.
Three classifications are used:

- **configurable** — already wired to `.n-dx.json` / `ndx config`
- **needs-wiring** — not currently configurable; candidate for a future config key
- **intentional** — deliberately fixed; rationale documented inline

---

## Already Configurable

| Package | File | Constant / key | Value | Config key |
|---------|------|----------------|-------|------------|
| core | `cli-timeout.js` | `DEFAULT_TIMEOUT_MS` | 1 800 000 ms (30 min) | `cli.timeoutMs` |
| core | `cli-timeout.js` | `COMMAND_TIMEOUT_DEFAULTS` | `work`/`self-heal` → 4 h | `cli.timeouts.<command>` |
| llm-client | `src/llm-types.ts:104` | `DEFAULT_LLM_RESPONSE_TIMEOUT_MS` | 300 000 ms (5 min) | `llm.responseTimeout` |
| hench | `src/store/run-retention-scheduler.ts:49` | `DEFAULT_RETENTION_INTERVAL_MS` | 86 400 000 ms (24 h) | `retention.intervalMs` |

---

## Needs Config Wiring

These are execution timeouts that could silently fail on slow machines or large codebases — the primary motivation for this audit epic.

### Hench agent tool timeouts

| File | Constant | Value | Proposed config key | Notes |
|------|----------|-------|---------------------|-------|
| `packages/hench/src/tools/test-runner.ts:50` | `DEFAULT_TIMEOUT` | 120 000 ms | `hench.toolTimeouts.testRunner` | Per-test run spawn |
| `packages/hench/src/tools/test-runner.ts:411` | `TEST_GATE_TIMEOUT` | 300 000 ms | `hench.toolTimeouts.testGate` | Gate run with retries |
| `packages/hench/src/tools/test-runner.ts:609` | `DEPENDENCY_AUDIT_TIMEOUT` | 60 000 ms | `hench.toolTimeouts.dependencyAudit` | Per-dep-audit command |
| `packages/hench/src/tools/cleanup-transformations.ts:111` | `DEFAULT_TYPECHECK_TIMEOUT` | 120 000 ms | `hench.toolTimeouts.typecheck` | `tsc` invocation |
| `packages/hench/src/tools/rex.ts:248` | `REQ_CMD_TIMEOUT` | 30 000 ms | `hench.toolTimeouts.rexCommand` | Rex CLI calls from agent |
| `packages/hench/src/validation/completion.ts:30` | `DEFAULT_TIMEOUT` | 30 000 ms | `hench.toolTimeouts.gitOp` | Git ops in validation (shared with review.ts below) |
| `packages/hench/src/agent/analysis/review.ts:28` | `DEFAULT_TIMEOUT` | 30 000 ms | `hench.toolTimeouts.gitOp` | Git diff/reset/clean |

### Rex domain tool timeouts

| File | Constant | Value | Proposed config key | Notes |
|------|----------|-------|---------------------|-------|
| `packages/rex/src/core/verify.ts:87` | `DEFAULT_TIMEOUT` | 120 000 ms | `rex.verifyTimeout` | Shell command execution in acceptance-criteria verification |

### Web server command proxy timeouts

These wrap CLI commands invoked from the dashboard; they're a second timeout layer on top of the existing `cli.timeouts.*` surface. They should either read from `cli.timeouts.*` or get their own keys.

| File | Line | Value | Notes |
|------|------|-------|-------|
| `packages/web/src/server/routes-commands.ts` | 127 | 180 000 ms | `sourcevision analyze` |
| `packages/web/src/server/routes-commands.ts` | 179 | 120 000 ms | `sourcevision analyze --deep` |
| `packages/web/src/server/routes-commands.ts` | 216 | 120 000 ms | `rex analyze` proposal |
| `packages/web/src/server/routes-commands.ts` | 264 | 120 000 ms | `rex analyze --accept` |
| `packages/web/src/server/routes-commands.ts` | 334 | 600 000 ms | shell command passthrough |
| `packages/web/src/server/routes-rex-analysis.ts` | 236 | 120 000 ms | init analysis |
| `packages/web/src/server/routes-rex-analysis.ts` | 641 | 240 000 ms | `SMART_ADD_TIMEOUT_MS` |
| `packages/web/src/server/routes-rex-analysis.ts` | 768 | 120 000 ms | batch analysis |

---

## Intentionally Hardcoded

### File-lock mechanics
*Internal concurrency control — not user-tunable.*

| File | Constant | Value | Rationale |
|------|----------|-------|-----------|
| `packages/rex/src/store/file-lock.ts:15` | `STALE_LOCK_MS` | 30 000 ms | Lock stale threshold; changing this risks deadlocks |
| `packages/rex/src/store/file-lock.ts:18` | `RETRY_DELAY_MS` | 50 ms | Spin-wait granularity |
| `packages/rex/src/store/file-lock.ts:21` | `ACQUIRE_TIMEOUT_MS` | 10 000 ms | Acquisition deadline; 10 s is already generous |

### Short safety-bound git/process timeouts
*Small fixed bounds — if they trigger something is already very wrong.*

| File | Value | Rationale |
|------|-------|-----------|
| `packages/rex/src/core/git-utils.ts:25` | 5 000 ms | Git --version / sanity check |
| `packages/hench/src/tools/git.ts:4` (`GIT_TIMEOUT`) | 15 000 ms | Git commands in agent tools |
| `packages/llm-client/src/auth.ts:28` | 5 000 ms | `claude --version` check |
| `packages/web/src/server/routes-project.ts:84` | 5 000 ms | Git branch/status in dashboard |
| `packages/hench/src/process/memory-monitor.ts:160` | 5 000 ms | Process-list query |
| `packages/hench/src/quota/codex-token-retrieval.ts:119` (`DEFAULT_TIMEOUT_MS`) | 5 000 ms | Token retrieval lookup |

### LLM retry / backoff algorithm parameters
*Algorithm-level constants — exposing them would complicate config without user benefit.*

| File | Constant | Value | Rationale |
|------|----------|-------|-----------|
| `packages/llm-client/src/api-provider.ts:49` | `DEFAULT_BASE_DELAY_MS` | 1 000 ms | Exponential backoff base |
| `packages/llm-client/src/cli-provider.ts:66-67` | `DEFAULT_BASE_DELAY_MS` / `DEFAULT_MAX_DELAY_MS` | 1 000 / 10 000 ms | CLI provider backoff |
| `packages/llm-client/src/codex-cli-provider.ts:50-51` | same | 1 000 / 10 000 ms | Codex provider backoff |
| `packages/llm-client/src/google-api-provider.ts:37` | `DEFAULT_BASE_DELAY_MS` | 1 000 ms | Google API backoff |
| `packages/llm-client/src/openai-api-provider.ts:35` | `DEFAULT_BASE_DELAY_MS` | 1 000 ms | OpenAI backoff |
| `packages/llm-client/src/rate-limit.ts:62` | `DEFAULT_AUTO_RETRY_THRESHOLD_MS` | 60 000 ms | Rate-limit retry window |
| `packages/llm-client/src/exec.ts:220` | `KILL_ESCALATION_MS` | 5 000 ms | SIGTERM → SIGKILL gap |
| `packages/llm-client/src/exec.ts:469` | `SHUTDOWN_KILL_ESCALATION_MS` | 1 000 ms | Shorter escalation on shutdown |
| `packages/hench/src/agent/lifecycle/loop.ts:59` | `BASE_DELAY_MS` | 1 000 ms | Agent loop backoff |
| `packages/hench/src/process/memory-throttle.ts:33-36` | `DEFAULT_BASE_DELAY_MS` / `DEFAULT_MAX_DELAY_MS` | 2 000 / 30 000 ms | Memory pressure backoff |
| `packages/hench/src/agent/lifecycle/commit-msg-watcher.ts:34` | `FALLBACK_POLL_INTERVAL_MS` | 1 000 ms | Commit-message watcher poll |

### Web server infrastructure
*Protocol compliance, cache freshness, broadcast cadence — not user-tunable without changing server behaviour.*

| File | Constant | Value | Rationale |
|------|----------|-------|-----------|
| `packages/web/src/server/start.ts:53` | `DEFAULT_SHUTDOWN_TIMEOUT_MS` | 30 000 ms | Graceful drain window |
| `packages/web/src/server/start.ts:220` | `WATCHER_DEBOUNCE_MS` | 500 ms | File-watcher debounce |
| `packages/web/src/server/start.ts:656` | `WS_HEALTH_BROADCAST_INTERVAL_MS` | 10 000 ms | WebSocket health ping |
| `packages/web/src/server/websocket.ts:323` | `PING_INTERVAL_MS` | 5 000 ms | WS keep-alive (protocol) |
| `packages/web/src/server/websocket.ts:79` | `RECENT_WINDOW_MS` | 60 000 ms | Recent-activity window |
| `packages/web/src/server/websocket.ts:82` | `DURATION_WINDOW_MS` | 300 000 ms | Duration tracking window |
| `packages/web/src/server/routes-mcp.ts:62` | `SESSION_TTL_MS` | 900 000 ms (15 min) | MCP session lifetime |
| `packages/web/src/server/routes-mcp.ts:65` | `SESSION_SWEEP_INTERVAL_MS` | 300 000 ms | Session cleanup sweep |
| `packages/web/src/server/mcp-schema-watcher.ts:25` | `DEBOUNCE_MS` | 500 ms | Schema-watcher debounce |
| `packages/web/src/server/routes-status.ts:99` | `CACHE_TTL_MS` | 5 000 ms | Status in-memory cache |
| `packages/web/src/server/routes-status.ts:217` | `HENCH_STALE_THRESHOLD_MS` | 300 000 ms | Run stale display threshold |
| `packages/web/src/server/routes-config.ts:70` | `CONFIG_CACHE_TTL_MS` | 10 000 ms | Config in-memory cache |
| `packages/web/src/server/routes-config.ts:73` | `PROJECTS_CACHE_TTL_MS` | 30 000 ms | Projects cache |
| `packages/web/src/server/routes-project.ts:56` | `CACHE_TTL_MS` | 30 000 ms | Project cache |
| `packages/web/src/server/routes-sourcevision.ts:71` | `PR_MARKDOWN_STALE_MS` | 1 800 000 ms (30 min) | PR markdown re-render threshold |
| `packages/web/src/server/routes-hench.ts:1291` | `STALE_THRESHOLD_MS` | 300 000 ms | Hench run stale threshold |
| `packages/web/src/server/routes-hench.ts:1297` | `HEARTBEAT_INTERVAL_MS` | 30 000 ms | Run heartbeat SSE |
| `packages/web/src/server/routes-hench.ts:1528` | `CONCURRENCY_BROADCAST_MS` | 10 000 ms | Concurrency status broadcast |
| `packages/web/src/server/routes-hench.ts:1804` | `MEMORY_BROADCAST_MS` | 10 000 ms | Memory status broadcast |
| `packages/web/src/server/routes-hench.ts:1681` | (literal) | 2 000 ms | Agent status probe |
| `packages/web/src/server/task-usage/usage-cleanup-scheduler.ts:45` | `DEFAULT_CLEANUP_INTERVAL_MS` | 604 800 000 ms (7 d) | Usage data retention |
| `packages/web/src/server/merge-history.ts:885` | `DEFAULT_HENCH_RUN_WINDOW_MS` | 86 400 000 ms (24 h) | Merge-history window |

### Hench agent internal lifecycle
*Heartbeat and orphan detection — operational semantics, not execution timeouts.*

| File | Constant | Value | Rationale |
|------|----------|-------|-----------|
| `packages/hench/src/agent/lifecycle/heartbeat.ts:22` | `HEARTBEAT_INTERVAL_MS` | 30 000 ms | Heartbeat cadence — too low causes excessive I/O; too high makes stale detection unreliable |
| `packages/hench/src/process/lifecycle.ts:33` | `DEFAULT_STALE_RUN_THRESHOLD_MS` | 120 000 ms | Orphan detection window (2 × heartbeat) |

### Rex domain governance thresholds
*PRD health heuristics — changing them changes what counts as "stuck" or "stale" in PRD reports.*

| File | Constant | Value | Rationale |
|------|----------|-------|-----------|
| `packages/rex/src/core/health.ts:52` | `DEFAULT_STALE_MS` | 172 800 000 ms (48 h) | Analysis recency threshold; already visible in `rex health` output |
| `packages/rex/src/core/structural.ts:51` | `DEFAULT_STUCK_THRESHOLD_MS` | 172 800 000 ms (48 h) | In-progress item age before flagged as stuck |
| `packages/web/src/server/routes-validation.ts:43` | `DEFAULT_STUCK_THRESHOLD_MS` | 172 800 000 ms (48 h) | Server-side mirror of the above |

### Sourcevision dynamic enrichment timeouts
*Computed from file/zone counts at runtime — not a single constant.*

| File | Range | Rationale |
|------|-------|-----------|
| `packages/sourcevision/src/analyzers/enrich-config.ts:198-220` | 120 000 – 600 000 ms | Scales with `totalFiles * 400 + zoneCount * 5_000`; exposing the formula as config is impractical |

### OAuth token buffer
*Security design — must not be shortened.*

| File | Constant | Value | Rationale |
|------|----------|-------|-----------|
| `packages/llm-client/src/google-oauth.ts:151` | `BUFFER_MS` | 60 000 ms | Token expiry safety margin |

### Viewer UI — polling, debounce, and performance gates
*UX and rendering-performance decisions — not execution timeouts.*

| File | Constant | Value | Rationale |
|------|----------|-------|-----------|
| `packages/web/src/viewer/polling/tick-timer.ts:37` | `TICK_INTERVAL_MS` | 1 000 ms | Dashboard poll tick |
| `packages/web/src/viewer/messaging/message-throttle.ts:85` | `DEFAULT_DELAY_MS` | 250 ms | Message throttle |
| `packages/web/src/viewer/messaging/message-coalescer.ts:83` | `DEFAULT_WINDOW_MS` | 150 ms | Coalesce window |
| `packages/web/src/viewer/messaging/call-rate-limiter.ts:45` | `DEFAULT_MIN_INTERVAL_MS` | 500 ms | Rate-limiter floor |
| `packages/web/src/viewer/polling/tick-visibility-gate.ts:99` | `DEFAULT_RESUME_DEBOUNCE_MS` | 100 ms | Visibility resume debounce |
| `packages/web/src/viewer/polling/polling-manager.ts:54` | `RESUME_DEBOUNCE_MS` | 100 ms | Poll resume debounce |
| `packages/web/src/viewer/components/search-overlay.ts:86` | `DEBOUNCE_MS` | 200 ms | Search input debounce |
| `packages/web/src/viewer/components/config-footer.ts:29` | `CONFIG_POLL_INTERVAL_MS` | 30 000 ms | Config footer poll |
| `packages/web/src/viewer/performance/refresh-throttle.ts:76-77` | `DEFAULT_BASE_INTERVAL_MS` / `DEFAULT_AVG_REFRESH_MS` | 5 000 / 800 ms | Render throttle |
| `packages/web/src/viewer/performance/dom-update-gate.ts:137` | `DEFAULT_RESUME_DEBOUNCE_MS` | 100 ms | DOM update gate |
| `packages/web/src/viewer/performance/dom-performance-monitor.ts:116` | `DEFAULT_INTERVAL_MS` | 2 000 ms | Perf monitor interval |
| `packages/web/src/viewer/performance/memory-monitor.ts:87` | `DEFAULT_INTERVAL_MS` | 5 000 ms | Memory monitor interval |
| `packages/web/src/viewer/performance/response-buffer-gate.ts:104` | `DEFAULT_RESUME_DEBOUNCE_MS` | 100 ms | Response buffer gate |
| `packages/web/src/viewer/usage/constants.ts:15` | `USAGE_POLL_INTERVAL_MS` | 10 000 ms | Usage view poll |

### Viewer UI — feedback / animation durations
*UX design decisions — fixed for product consistency.*

| File | Value | Purpose |
|------|-------|---------|
| `packages/web/src/viewer/views/pr-markdown.ts:31` (`COPY_FEEDBACK_MS`) | 2 000 ms | Copy button feedback |
| `packages/web/src/viewer/views/hench-runs.ts:773` | 3 000 ms | Highlight clear |
| `packages/web/src/viewer/views/task-audit.ts:548` | 3 000 ms | Toast clear |
| `packages/web/src/viewer/views/task-audit.ts:351/458` | 5 000 / 3 000 ms | Audit log poll |
| `packages/web/src/viewer/hooks/use-prd-deep-link.ts:94` | 3 000 ms | Deep-link highlight |
| `packages/web/src/viewer/components/rex-task-link.ts:112` | 2 000 / 800 ms | Error / success feedback |
| `packages/web/src/viewer/components/prd-tree/inline-add-form.ts:75` | 50 ms | Focus after mount |
| `packages/web/src/viewer/components/prd-tree/lazy-children.ts:28` (`UNMOUNT_DELAY_MS`) | 300 ms | Unmount animation |
| `packages/web/src/viewer/components/prd-tree/use-live-tick.ts:28` (`ONE_SECOND_MS`) | 1 000 ms | Live-time ticker |
| `packages/web/src/viewer/components/neolithic-overlay.ts:46` (`FRAME_MS`) | 400 ms | Overlay animation |
| `packages/web/src/viewer/components/active-tasks-panel.ts:241` | 5 000 ms | Panel poll |
| `packages/web/src/viewer/components/active-tasks-panel.ts:55` (`STALE_THRESHOLD_MS`) | 300 000 ms | Active-tasks stale display |
| `packages/web/src/viewer/components/throttle-controls.ts:130` | 10 000 ms | Throttle-controls poll |
| `packages/web/src/viewer/hooks/use-app-data.ts:120` | 50 ms | Initial callback delay |
| `packages/web/src/landing/landing.ts:230,306` | 50 / 800 / 600 ms | Demo terminal animation |

---

## Remediation Scope Summary

The follow-on remediation task should wire config keys for the **Needs Config Wiring** entries above.
Suggested grouping:

1. **`hench.toolTimeouts.*`** — test runner, typecheck, rex commands, git ops (7 constants, one file each)
2. **`rex.verifyTimeout`** — acceptance-criteria shell verification (1 constant)
3. **Web server command proxy timeouts** — either read from `cli.timeouts.*` or introduce `web.commandTimeouts.*` (8 inline literals across 2 files)
