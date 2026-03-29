# Architecture & Audit Document: SourceVision Analysis Phases Panel

## 1. Proposed Implementation Overview

### What We're Building

A clickable **Analysis Phases** panel on the SourceVision Overview page. The panel displays all 7 analysis phases as interactive cards with:
- Phase status (pending/running/complete/error)
- Last-run timestamps
- Run and Reset action buttons
- Pulse animation for actively running phases

The panel replaces the existing "Getting Started" section (`overview.ts:214-228`) which currently shows static CLI commands.

### Architecture Fit

This feature spans two internal web zones:

| Zone | Files Affected | Role |
|------|---------------|------|
| **web-server** | `routes-sourcevision.ts` | New GET/POST endpoints for phase status and execution |
| **web-viewer** | `components/phase-panel.ts`, `views/overview.ts`, `styles/phase-panel.css` | UI component and integration |

**Cross-zone data flow:**
1. Viewer fetches `GET /api/sv/phases` (reads manifest.json)
2. User clicks Run → Viewer sends `POST /api/sv/phases/:n/run`
3. Server spawns `sourcevision analyze --phase=N` via `spawnManaged`
4. Server polls manifest.json for status changes, broadcasts `sv:phase-update` via WebSocket
5. Viewer receives WebSocket update, re-renders card state

### Key Dependencies

- **`spawnManaged` from `@n-dx/llm-client`** — managed child process spawning (already used in `routes-rex/execution.ts:130`, `routes-hench.ts:1102`)
- **WebSocket infrastructure** — `createWebSocketManager` in `start.ts`, broadcast pattern from `routes-rex/execution.ts:73-80`
- **Manifest schema** — `ModuleInfo` type with `status: "pending" | "running" | "complete" | "error"` plus timestamps (`sourcevision/src/schema/v1.ts`)

---

## 2. Dashboard Clickable Elements Audit

### Summary Statistics

| Category | Count |
|----------|-------|
| Total interactive elements | 300+ |
| View files with interactions | 16 |
| Component files with interactions | 20+ |
| Server mutation endpoints (POST/PUT/DELETE/PATCH) | 44 |
| WebSocket broadcast message types | 10 |
| API endpoints called from UI | 40+ |

### Action Types Taxonomy

Interactive elements on the dashboard fall into **6 categories**:

| Type | Description | Risk Level | Example |
|------|-------------|------------|---------|
| **Navigation** | View switching, drill-down, breadcrumbs | None | `navigateTo("zones", { zone })` |
| **State toggle** | Expand/collapse, filter, sort | None (local) | Collapsible sections, sort headers |
| **Read-only fetch** | Load data for display | None | `GET /api/rex/dashboard` |
| **Data mutation** | Create/update/delete PRD items | Medium | `POST /api/rex/items`, `PATCH` |
| **Process spawn** | Start CLI tools as child processes | High | `POST /api/rex/execute/epic-by-epic` |
| **Destructive** | Prune, delete, emergency stop | High | `POST /api/rex/prune`, emergency-stop |

### Interactive Elements by View

#### Sidebar & Navigation (`components/sidebar.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| Logo/Home button | Navigation | `navigateTo(firstSection)` |
| Section nav buttons | Navigation | `handleNav(defaultView)` |
| Page nav buttons | Navigation | `handleNav(entry.id)` |
| Mobile menu toggle | State toggle | `mobileOpen` state |
| Section expansion | State toggle | `toggleSection()` |
| Analysis progress click | Navigation | `navigateTo("overview")` |

#### Overview (`views/overview.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| View All Zones link | Navigation | `navigateTo("zones")` |
| Top zone items | Navigation | `navigateTo("zones", { zone })` |
| View Files link | Navigation | `navigateTo("files")` |
| Hotspot file links | Navigation | `navigateTo("files", { file })` |
| Circular dep links | Navigation | `navigateTo("explorer", { cycle })` |
| **NEW: Phase Run buttons** | **Process spawn** | **`POST /api/sv/phases/:n/run`** |
| **NEW: Phase Reset buttons** | **Data mutation** | **`POST /api/sv/phases/:n/reset`** |

#### PRD View (`views/prd.ts`, `components/prd-tree/`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| Task status buttons | Data mutation | `PATCH /api/rex/items/:id` |
| Tag add/remove | Data mutation | `PATCH /api/rex/items/:id` |
| Edit title/description | Data mutation | `PATCH /api/rex/items/:id` |
| Add/remove criteria | Data mutation | `PATCH /api/rex/items/:id` |
| Child item navigation | Navigation | `onNavigate(child.id)` |
| Priority selector | Data mutation | `PATCH /api/rex/items/:id` |
| Smart-add examples | State toggle | Pre-fills input |
| Scope selector | State toggle | Updates selected scope |
| Bulk status update | Data mutation | `PATCH /api/rex/items/bulk` |
| Proposal accept/reject | Data mutation | `POST /api/rex/proposals/accept` |
| Search clear | State toggle | Clears query |
| Add item toggle | State toggle | Shows add form |
| Prune toggle | State toggle | Shows prune panel |

#### Rex Dashboard (`views/rex-dashboard.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| View Tasks button | Navigation | `navigateTo("prd")` |
| Browse Tasks button | Navigation | `navigateTo("prd")` |
| Validate PRD button | Navigation | `navigateTo("validation")` |
| Reorganize button | State toggle | `setReorgOpen(true)` |

#### Hench Runs (`views/hench-runs.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| Mark Stuck button | Data mutation | `POST /api/hench/runs/:id/mark-stuck` |
| Retry button | Read-only fetch | `fetchRuns()` |
| Status filter buttons | State toggle | `setStatusFilter(key)` |
| Run selection | State toggle | `handleSelectRun(run.id)` |

#### Explorer (`views/sv-explorer.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| Files/Split mode toggle | State toggle | `handleModeChange()` |
| Role/Language/Zone/Archetype filters | State toggle | Filter state updates |
| Show All Files toggle | State toggle | Visibility toggle |
| Edge type filter pills | State toggle | `handleToggleEdgeType()` |
| Zone legend click | State toggle | Collapse/expand |

#### Files (`views/files.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| Column sort headers (8) | State toggle | `toggleSort(column)` |
| Row click | Navigation | `onSelect(file)` detail panel |
| Role/Language/Zone/Archetype filters | State toggle | Filter state updates |

#### Zones (`views/zones.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| Zone file row click | Navigation | `onClick()` callback |
| Zone file row double-click | Navigation | `onDblClick()` callback |
| Subzone toggle | State toggle | `onToggle()` |
| Zone drill-down button | Navigation | `onDrillDown()` |
| Zone detail button | Navigation | `onSelectZone()` |
| Breadcrumb navigation | Navigation | `onNavigate(index)` |

#### Analysis View (`views/analysis.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| Tab switches (Smart-Add, Batch Import, Scan) | State toggle | `setActiveTab()` |
| No LLM checkbox | State toggle | `toggles noLlm` |
| Analyze button | Process spawn | `POST /api/rex/analyze` |
| Accept proposals | Data mutation | `POST /api/rex/proposals/accept` |

#### Validation (`views/validation.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| Check header expansion | State toggle | Expand/collapse |
| Error item navigation | Navigation | `onNavigate(err.itemId)` |
| Dependency node selection | Navigation | `onSelect(node.id)` |
| Tab switches | State toggle | `setActiveTab()` |

#### Config Surface (`views/config-surface.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| Zone navigation | Navigation | `navigateTo("zones", { zone })` |

#### Token Usage (`views/token-usage.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| Retry button | Read-only fetch | `fetchData()` |
| Period toggle buttons | State toggle | `setPeriod(p)` |
| Package filter | State toggle | `setPkgFilter()` |
| Clear date range | State toggle | Clears filters |

#### Hench Config (`views/hench-config.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| Config select/checkbox | Data mutation | `PUT /api/hench/config` |
| Tag remove | Data mutation | `PUT /api/hench/config` |
| Template save | Data mutation | `POST /api/hench/templates` |
| Template apply | Data mutation | `POST /api/hench/templates/:id/apply` |
| Template delete | Destructive | `DELETE /api/hench/templates/:id` |

#### Throttle Controls (`components/throttle-controls.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| Concurrency input | Data mutation | `PUT /api/hench/throttle` |
| Concurrency reset | Data mutation | `PUT /api/hench/throttle` (default) |
| Pause button | Process spawn | `POST /api/hench/throttle/pause` |
| Resume button | Process spawn | `POST /api/hench/throttle/resume` |
| Emergency stop | Destructive | `POST /api/hench/throttle/emergency-stop` |

#### Integrations & Notion (`views/integration-config.ts`, `views/notion-config.ts`)
| Element | Action Type | Trigger |
|---------|------------|---------|
| Token visibility toggle | State toggle | Local state |
| Save config | Data mutation | `POST /api/integrations/:id/config` |
| Remove integration | Destructive | `DELETE /api/integrations/:id/config` |
| Test connection | Read-only fetch | `POST /api/notion/test` |

#### Shared Components
| Component | Element | Action Type | Trigger |
|-----------|---------|------------|---------|
| `detail-panel.ts` | View in Graph/Files/Problems/Suggestions | Navigation | `navigateTo()` |
| `zone-slideout.ts` | File clicks, View buttons, Trend opener | Navigation | `navigateTo()`, callbacks |
| `search-overlay.ts` | Result selection, filter toggles | Navigation + State | `onSelect(result)` |
| `faq.ts` | Section toggles, open/close | State toggle | Local state |
| `guide.ts` | Open/close guide | State toggle | Local state |
| `copy-link-button.ts` | Copy button | Clipboard | `navigator.clipboard.writeText()` |
| `crash-recovery-banner.ts` | Recovery buttons | Navigation | Recovery actions |

---

## 3. Server Mutation Endpoints (Complete Inventory)

### Process-Spawning Endpoints (7 total)

These are the highest-risk endpoints — they spawn CLI tools as child processes:

| Endpoint | Method | Subprocess | File |
|----------|--------|-----------|------|
| `/api/rex/execute/epic-by-epic` | POST | `hench run --epic=ID --loop --auto` | `routes-rex/execution.ts:130` |
| `/api/rex/execute/pause` | POST | Kills hench (SIGINT) | `routes-rex/execution.ts:366` |
| `/api/rex/execute/resume` | POST | Re-spawns hench | `routes-rex/execution.ts:389` |
| `/api/rex/analyze` | POST | `rex analyze` via foundationExec | `routes-rex/analysis.ts:168` |
| `/api/rex/smart-add-preview` | POST | `rex add` via foundationExec | `routes-rex/analysis.ts:508` |
| `/api/rex/batch-import` | POST | `rex add` via foundationExec | `routes-rex/analysis.ts:578` |
| `/api/hench/execute` | POST | `hench run` via spawnManaged | `routes-hench.ts:1014` |
| `/api/hench/throttle/emergency-stop` | POST | Kills ALL hench processes | `routes-hench.ts:2382` |

**The new phase run endpoint will join this category:**
| `/api/sv/phases/:n/run` | POST | `sourcevision analyze --phase=N` | `routes-sourcevision.ts` (new) |

### WebSocket Broadcast Types (10 total)

| Message Type | Source | Payload |
|-------------|--------|---------|
| `rex:item-updated` | Item PATCH | `{ id, changes }` |
| `rex:item-deleted` | Item DELETE | `{ id }` |
| `rex:prd-changed` | Add/merge/prune/accept | `{}` (generic refresh) |
| `rex:execution-progress` | Epic execution | `{ status, epics[], percent }` |
| `hench:run-started` | Task execution | `{ runId, taskId }` |
| `hench:run-completed` | Task execution | `{ runId, taskId, status }` |
| `hench:run-terminated` | Termination | `{ runId }` |
| `hench:throttle-changed` | Throttle updates | `{ concurrency, paused }` |
| `hench:emergency-stop` | Emergency stop | `{}` |
| **`sv:phase-update`** | **Phase run/complete/reset** | **`{ phases[] }`** (new) |

---

## 4. Design Constraints for the Phase Panel

### Singleton Execution Guard

The server must prevent concurrent phase runs. Pattern follows `routes-rex/execution.ts`:
- Singleton `phaseExecutionState` variable tracks current running phase
- `POST /api/sv/phases/:n/run` returns 409 if a phase is already running
- State resets on process exit (success or error)

### Manifest Polling

Since `sourcevision analyze` writes manifest.json directly, the server needs to poll the file to detect completion:
- Poll every 2-3 seconds while a phase is running
- Compare `modules[key].status` for transitions from `running` → `complete` or `error`
- Broadcast `sv:phase-update` on each detected change
- Stop polling when phase process exits

### CSS Animation Pattern

Running phases use a pulse animation consistent with existing patterns:
```css
/* Existing pattern from badges.css:84 */
@keyframes status-badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* New phase-specific variant */
@keyframes phase-pulse {
  0%, 100% { border-color: var(--accent); box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.2); }
  50% { border-color: var(--accent); box-shadow: 0 0 8px 2px rgba(var(--accent-rgb), 0.15); }
}
```

### Component Communication

The PhasePanel needs access to WebSocket messages. Options:
1. **Prop-drilled callback** from `app.ts` (consistent with how other components receive WS data)
2. **Direct fetch + setInterval fallback** if WS is unavailable (graceful degradation)

The recommended approach is option 1 — consistent with existing patterns where views receive data via props from the app shell.

---

## 5. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Concurrent phase + CLI analysis | Medium | Singleton guard; disable Run buttons globally when any phase runs |
| Manifest write conflict (CLI + server reset) | Low | Reset only writes one field; CLI writes atomically |
| Long-running phase blocks UI | None | Spawn is async; UI updates via WebSocket |
| Phase prerequisite failures | Low | Server can check manifest for required prior phases before spawning |
| Stale manifest cache in server | Low | Always read manifest fresh for `/api/sv/phases` (no caching) |
