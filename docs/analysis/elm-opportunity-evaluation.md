# ELM Opportunity Evaluation for n-dx

**Status:** Analysis / decision-support. No production code changed by this report.
**Question:** Where — if anywhere — would an Extreme Learning Machine (ELM), a cheap local supervised model, reduce LLM token cost/latency or unlock a new capability in n-dx, and under what design?
**Bottom line:** Grading *existing* LLM calls yields almost nothing worth doing. The real value is in **new, architecture-aware capabilities** for hench, where a retrieval fast-path (with an ELM reranker once labels accrue) can shrink the expensive agent loop, and in two sourcevision spots where labels already exist. Every path is additive, flag-gated, off by default, and reversible. "Do nothing" remains defensible for several sub-candidates and is called out where it applies.

---

## 1. What an ELM is (and isn't), in one paragraph

A single-hidden-layer net whose input→hidden weights are random and **frozen**; only the linear hidden→output layer is trained, via a closed-form ridge/least-squares solve. Consequences: trains in ms on CPU, in-process, deterministic given a seed (no drift); it is **supervised** (needs labels); it has no language understanding (you must featurize text first); and its ceiling is bounded by feature + label quality. It is the right tool for **bounded, repeated, fallback-safe classification/ranking with available labels** — and the wrong tool for open-ended generation, reasoning, unsupervised clustering, or anything without labels (use KNN/embeddings there instead).

## 2. The Hard Invariant (governs every recommendation here)

Any ELM/retriever introduced is **only ever an additive, reversible, gated fast-path in front of unchanged behavior**:
- Behind a flag, **off by default**. Deleting it returns the system byte-for-byte to today.
- On low confidence, missing data, or stale inputs → it does nothing; original behavior runs untouched.
- It never modifies or removes a working LLM call, and never mutates a canonical/deterministic output.
- Fallback is always the exact current path. A confident mistake is caught by that fallback.

If a candidate cannot satisfy this, it is out of scope.

## 3. Decision rule applied to every candidate

A task is an ELM candidate only if it is mostly "yes" on all four:
1. **Bounded output** — classify / route / rank / score / match (not open-ended generation or reasoning).
2. **Repeated** — runs often enough that per-call savings compound.
3. **Fallback-safe** — a confident mistake is harmlessly caught.
4. **Labels available cheaply** — the usual real cost; no labels → no supervised ELM (consider KNN instead).

---

## 4. Is there even a token-cost problem? (measurement)

- **Where spend actually concentrates:** hench's autonomous agent loop (`packages/hench/src/agent/lifecycle/loop.ts`, `MAX_CONTEXT_PAIRS=20`, context grows per turn). This is open-ended reasoning + code writing — **not ELM-able**, and already heavily prompt-cached (one real run: `cacheRead 5,294,508` vs `input 226 / output 822` billable).
- **Bounded LLM spend is small and already minimized:** the only bounded token-spending call site is sourcevision's archetype-classification **fallback** (already heuristic-backed, gated off in `--fast`, incremental).
- **Cost pressure is acknowledged in-code** (budgets, weekly quota tracking in `packages/hench/src/quota/`, `RunStatus:"budget_exceeded"`, retry/backoff, an entire "Reshape Proposal Caching" epic), but there is **no per-call cost ledger** — cost is estimated at Sonnet rates in `packages/rex/src/core/token-usage.ts`.

**Conclusion:** there is no large, bounded, ELM-shaped token bill to clip directly. The leverage is **indirect** — reduce work on the expensive loop by feeding hench better context — plus **quality** upgrades where labels already exist.

## 5. Training-data reality check (decisive constraint)

n-dx logs token **counts** thoroughly but **never stores prompt inputs or LLM outputs**. On disk today: ~15 hench runs (most empty; 0 with event transcripts; prompts never persisted), `.rex/execution-log.jsonl` ~14 lines. **The teacher→student pattern has no ready corpus.** This kills any "train a student on logged input→output pairs" idea *until we generate labels deliberately*.

**But three real label sources already exist or are cheap to harvest:**

| Label source | Where | Enables |
|---|---|---|
| Agent `Read` events per task | `toolCalls` in `.hench/runs/*.json` (`ToolCallRecord`) | "Which suggested file did the agent actually use" → **context reranker** |
| User archetype overrides | `set_file_archetype` → `source:"user-override"` in `classifications.json` | **archetype classifier** labels |
| Finding accept/reject | `.rex/acknowledged-findings.json` (~200 KB already) | **findings-prioritization** ranker labels |

This table is the single most important finding in the report: it identifies exactly where supervised ELMs are *justified* rather than *force-fit*.

## 6. LLM call-site inventory (what's bounded vs open-ended)

Every LLM call funnels through `client.complete()` / Gemini `generateContentWithTools()` in `packages/llm-client`, via two wrappers: `spawnClaude` (`packages/rex/src/analyze/llm-bridge.ts:135`) and `callClaude`/`callLLM` (`packages/sourcevision/src/analyzers/claude-client.ts:145`).

**Bounded (ELM-relevant), ranked:**
1. **Archetype classification fallback** — `packages/sourcevision/src/analyzers/classify.ts:328` (`enrichClassificationsWithLLM`), wired at `analyze-phases.ts:219`. 1-of-17 label, paths only, one call / 30 unclassified files, non-fast only. *Labels exist.* Strongest supervised fit; smallest payoff (already rare).
2. **Finding severity re-classification** — `enrich-batch.ts:70` (`runMetaEvaluation`). 3-way label per finding. Borderline.
3. **Task-granularity assessment** — `packages/rex/src/analyze/reason.ts:1493` (`assessGranularity`). Bucketed. Infrequent (once per `assess`).
4. **Guided-intake routing** — `packages/rex/src/analyze/guided.ts:100` (`clarify`), the `clarifying|ready` gate. Mixed (routing is bounded; questions are generation).

**Open-ended (leave on the LLM):** all rex PRD generation/restructuring (`reason.ts` family, `reshape-reason.ts`, `modify-reason.ts`, `decompose.ts`), zone *naming* enrichment (`enrich.ts` — open-vocabulary), and the hench agent loop.

**Already deterministic (no tokens to save — ELM = quality only):** file role/language/category (`inventory.ts`), hench file category (`file-classifier.ts`), priority scheduling (`priority-scheduler.ts`), next-task selection (`next-task.ts`), facet suggestion (`facets.ts:152`, naive substring), dedup/similarity (`dedupe.ts`), branch-work classification (`branch-work-classifier.ts`), analyze scanners (`scanners.ts`).

---

## 7. Primary opportunity: architecture-aware hench briefs (Retriever + ELM reranker)

### 7.1 The gap

hench's brief (`assembleTaskBrief`, `packages/hench/src/agent/planning/brief.ts:151`) is **pure PRD metadata** — task text, acceptance criteria, parent chain, siblings, last-10 log lines. It carries **zero code/architecture context** and reads **no** sourcevision output (confirmed: no sourcevision gateway; hench and sourcevision are sibling domain packages with no edge). The agent rediscovers structure by burning exploration turns on the expensive loop — structure sourcevision already computed (1370 files, 30 zones, 3075 import edges, 132K call-graph edges, 571 archetypes).

### 7.2 Why retrieval first, ELM reranker second (the honest sequencing)

The decision introduced — "which files/findings are relevant to *this* task?" — is **unsupervised retrieval**: no relevance labels exist at t=0. That fits **graph/embedding/TF-IDF KNN**, not a supervised ELM. So:
- **Phase A (retriever):** ship the value with no ML. Then
- **Phase B (harvest):** log which suggested files the agent actually `Read`. Then
- **Phase C (ELM reranker):** once labels clear a floor, train an ELM to reorder the retriever's shortlist. This is the one place a teacher→student ELM is genuinely justified *and* cheaply labeled.

### 7.3 Insertion seam (reuse; do not invent)

`extraContext` → `"context"` prompt section already injects `CONTEXT.md` for pair-programming:
`run.ts:1019-1031` → `prepareBrief(..., extraContext)` (`shared.ts:163`) → `buildPromptEnvelope` (`prompt.ts:179-192`, appends at `:190`). Populating it needs **no schema change**.

### 7.4 Reading sourcevision without breaking the tier rule

Do **not** `import @n-dx/sourcevision` from hench (new cross-domain edge; `rex-gateway.ts:9-24` documents hench→rex as the only allowed one). Instead **read the on-disk JSON** (fs + `JSON.parse`) — same pattern `dead-code-analyzer.ts` and the web dashboard already use; a file read is not an import, so it doesn't trip `domain-isolation.test.js`. Use the `DATA_FILES` names (`packages/sourcevision/src/schema/data-files.ts`) and the `loadData()` shape (`packages/sourcevision/src/cli/mcp.ts:36-70`); gate on `manifest.json` mtime — missing/stale → inject nothing.

### 7.5 Design (Phase A)

New module `packages/hench/src/agent/planning/architecture-context.ts` → `buildArchitectureContext(brief, targetDir, opts): string | null`. Ranking signals, cheapest-first:
1. **Graph/zone proximity (deterministic, strongest):** task references a path/zone → pull import-neighbors (`imports.json`) + zone co-members (`zones.json`).
2. **TF-IDF cosine (pure in-process JS — no Python):** query = task title+description+acceptance criteria+parent-chain; docs = per-file identifiers + findings `text`.
3. **Findings boost:** up-weight files in open findings' `scope`/`related` (`anchors` are empty pre-enrichment).

Output top-K files (~5-10) + top-M findings (~3-5) as a markdown block. Confidence gate below threshold → inject nothing. Config `hench.architectureContext` (default **false**) + `--architecture-context` flag. Seeded/deterministic.

### 7.6 ELM reranker (Phase C)

Features per (task, candidate-file): retriever sub-scores + file metadata (archetype, role, import-degree, zone cohesion/coupling). Label: `wasUsed` (agent Read it). Model: **~15-line in-process JS ELM** (`H=tanh(X·W+b)`, `beta=pinv(H)·Y`, fixed seed) preferred to keep one runtime and determinism; Python sidecar (`RBFSampler`+`RidgeClassifier` / `skelm`) only if JS linear algebra is fiddly. It **only reorders** the already-safe shortlist; low confidence → Phase-A order. Own sub-flag, off by default.

---

## 8. sourcevision-native ELM candidates

### 8.1 Archetype classifier (cleanest supervised fit, smallest payoff)

ELM in front of the LLM fallback (`classify.ts:328`): featurize path/filename/import tokens → predict 1-of-17 archetype; if `predict_proba` clears threshold use it, else fall through to the **untouched** LLM fallback. **Labels already exist** (351 algorithmic classifications + `set_file_archetype` user overrides; `evidence[]` gives features). Honest caveat: the fallback is already rare, so token savings are small — value is a **learning POC** and an accuracy upgrade on the 220 currently-unclassified files. Also the best sandbox to prove the JS-ELM that Phase C (§7.6) reuses.

### 8.2 Findings prioritization (strong: labels already exist)

`get_next_steps` ranks recommendations by rules today. `.rex/acknowledged-findings.json` (~200 KB) already records which findings users **accept/reject** — a ready supervised signal for an ELM that learns "is this finding worth surfacing." Extends naturally to gating `scanners.ts:602` `isActionable` (keep/drop before findings become PRD tasks), which cuts downstream LLM proposal calls. **This is the most under-rated candidate** and should be treated as first-class alongside §7.

### 8.3 Not ELM-shaped (documented to prevent force-fit)

Zone *detection* (Louvain = unsupervised graph clustering, different math); zone *naming* (open-vocabulary generation); role/language/category (deterministic, free). The "does this zone need LLM enrichment" **gate** is ELM/heuristic-shaped — but `isStructuralZone` (`enrich.ts:279`) already does a deterministic version; extend that heuristic before reaching for ML.

---

## 9. Q2: Auto-adding to sourcevision results as hench builds (the self-improving loop)

**New capability, genuinely promising, with one firm guardrail.**

**Existing additive write-seam:** `set_file_archetype` (`mcp.ts:417`) writes `source:"user-override"` classifications that the classifier **preserves across re-analysis** (`classify.ts:86-95`), and re-classification is already incremental (`classify.ts:99-110`). So an external actor contributing annotations that survive re-runs is a **proven pattern** — hench can contribute learned annotations through an analogous channel.

**The loop:** hench reads sourcevision (§7) → hench emits labels as it works (Read-events, archetype-in-practice, finding-usefulness) → labels train ELMs (retrain in ms; true online variants exist, e.g. OS-ELM) → ELMs sharpen both hench's context reranker (§7.6) *and* sourcevision's finding priority (§8.2) → better next run. This is the teacher→student cascade closing into a self-improving system, fed for free by normal agent activity.

**Guardrail (non-negotiable):** do **not** auto-mutate canonical `.sourcevision/*.json`. They must stay reproducible from static analysis, and the concurrency contract already marks `ndx work` + `ndx ci` both writing `.sourcevision/` as unsafe. Learned signals live in a **separate additive overlay** (e.g. `.sourcevision/learned/` or under `.hench/`), gated, off by default, merged only at read time — never overwriting the deterministic base. Deleting the overlay restores today's behavior exactly (Invariant).

---

## 10. Full candidate evaluation matrix

| # | Candidate | New feature? | Bounded | Frequency | Labels available | Token savings | ELM fit | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | **Hench brief context reranker** (§7) | Yes | Rank | Per task | **Yes** (Read-events, harvest) | Indirect, **potentially large** (fewer agent turns) | Strong (Phase C) | **Prototype** — retriever now, ELM reranker after labels |
| 2 | **Findings prioritization / actionable gate** (§8.2) | Extends | Rank/gate | Per analyze | **Yes** (`acknowledged-findings.json`) | Cuts downstream proposal calls | Strong | **Prototype** (fast follow) |
| 3 | Archetype classifier (§8.1) | No (fast-path) | 1-of-17 | Per unclassified batch | **Yes** (heuristic + overrides) | Small | Strong fit / low payoff | **Optional POC** (learning + JS-ELM sandbox) |
| 4 | Hench→SV learned overlay / online ELM (§9) | Yes | Various | Continuous | Yes (agent activity) | Compounds via loop | Strong (depends on 1–2) | **Design now, build after 1** |
| 5 | Finding severity re-classification (§6.2) | No | 3-way | Per meta pass | Weak | Small | Borderline | **Defer** |
| 6 | Facet/tag suggestion upgrade (`facets.ts:152`) | No | 1-of-N | Per item | Yes (user facets) | **None** (already free) | Good | **Quality-only** — not for cost; do if quality matters |
| 7 | Guided-intake routing gate (`guided.ts:100`) | No | Binary | Per round | Weak | Small | Borderline | **Defer** |
| 8 | Next-task selection tuning (`next-task.ts:165`) | No | Rank | Per selection | Weak/confounded | None | Weak | **Do nothing** |
| 9 | Semantic cache over reshape/analyze proposals | Yes | Reuse/recompute | Per analyze | n/a | Potentially large | **KNN, not ELM** | Separate track (embeddings) |
| 10 | Zone detection / naming | — | — | — | — | — | **Not ELM** | Excluded |

## 11. Cross-cutting constraints

- **Language mismatch:** n-dx is Node/TS; canonical ELM tooling is Python. **Mitigation:** the retriever (TF-IDF) and the ELM itself (random features + ridge) can be pure in-process JS, keeping one runtime and determinism. Reserve a Python sidecar (scikit-learn / `skelm` / `sentence-transformers`) only if semantic embeddings clearly beat TF-IDF on a holdout.
- **Concurrency contract:** never write canonical `.sourcevision/` or the PRD tree from a learned fast-path; use additive overlays and read-time merge only.
- **Determinism:** seed everything; ELMs are deterministic given a seed — a feature (reproducible briefs), not a risk.
- **Reversibility:** every path is a deletable module + a default-false flag.

## 12. Bars, verification, measurement

**Adopt-by-default bar (set up front):** flag-ON shows **≥15% reduction in agent-loop tokens or turns at no worse task-success** vs flag-OFF on a held-out task set. Phase C must beat Phase A ordering on held-out `used@K`. Miss the bar → **abandon** (delete shortcut; system unchanged). Enabling by default needs explicit sign-off.

**How to measure (data already captured):**
1. **Invariant proof:** flag-OFF ⇒ byte-identical brief vs baseline (snapshot test); deleting the module returns to baseline.
2. **Retriever quality:** fixture repo with hand-labeled task→file relevance; assert injected top-K contains the relevant files (deterministic).
3. **Real savings:** run ~5-10 real tasks flag-OFF vs flag-ON; compare `tokens`/`turns` from `.hench/runs/*.json` + task success.
4. **Label harvest:** confirm `.hench/architecture-labels.jsonl` fills with `wasUsed` from Read events.
5. **Reranker:** held-out label split; ELM order beats retriever order on `used@K` before enabling its sub-flag.
6. **Findings ranker (§8.2):** backtest against `acknowledged-findings.json` — does ELM rank accepted findings above rejected on a holdout?

## 13. Roadmap

- **Milestone 1 (this branch):** §7 Phase A retriever + Phase B label harvest, flag off. Ship value, start data.
- **Milestone 2:** §8.2 findings-prioritization ELM (labels already exist — fastest to prove).
- **Milestone 3:** §7 Phase C ELM reranker once labels clear the floor.
- **Milestone 4:** §9 learned-overlay + online retraining loop.
- **Optional anytime:** §8.1 archetype ELM as JS-ELM sandbox / learning POC.
- **Excluded / do-nothing:** #5, #7, #8, #10; #6 only if quality (not cost) is the goal; #9 is a separate embeddings track, not ELM.

## 14. Recommendation

Proceed with **Milestone 1** on this branch — it's the honest right-tool (retrieval), self-contained, Invariant-safe, and it seeds the labels that make everything downstream justified. Treat **§8.2 findings prioritization** as the fastest ELM win (labels already on disk). Keep **§8.1 archetype ELM** as an optional learning sandbox. **Nothing is enabled by default and no working LLM path or canonical output is modified** without a cleared bar and explicit sign-off. "Abandon" per sub-candidate remains an expected, respectable outcome.

---

### Appendix A — Key file/line index

- Hench brief: `packages/hench/src/agent/planning/brief.ts:151` (`assembleTaskBrief`), `:246-259` (assembly), `:314-404` (`formatTaskBrief`)
- Prompt envelope / context seam: `packages/hench/src/agent/planning/prompt.ts:179-192` (`:190` context); `packages/hench/src/agent/lifecycle/shared.ts:157-168` (`prepareBrief`); `packages/hench/src/cli/commands/run.ts:1019-1031`
- Task selection: `packages/rex/src/core/next-task.ts:165` (`makeComparator`), `:272-294` (`collectActionable`)
- Gateways / tier rule: `packages/hench/src/prd/rex-gateway.ts:9-24`
- SV archetype classify: `packages/sourcevision/src/analyzers/classify.ts:135` (heuristic), `:328` (LLM fallback), `:86-95` (override preservation), `:99-110` (incremental); wired `analyze-phases.ts:219`
- SV data access: `packages/sourcevision/src/schema/data-files.ts` (`DATA_FILES`); `packages/sourcevision/src/cli/mcp.ts:36-70` (`loadData`), `:417` (`set_file_archetype`), `:248-272` (`get_findings`)
- SV findings/zones schema: `packages/sourcevision/src/schema/v1.ts:180-204` (Finding), `:230-278` (Zone)
- Enrichment: `packages/sourcevision/src/analyzers/enrich.ts:279` (`isStructuralZone`); `enrich-batch.ts:70` (`runMetaEvaluation`)
- Token/quota: `packages/rex/src/core/token-usage.ts`; `packages/hench/src/quota/`; run schema `packages/hench/src/schema/v1.ts` (`RunRecord`, `ToolCallRecord`)
- Label sources on disk: `.hench/runs/*.json` (Read events), `.sourcevision/classifications.json` (overrides), `.rex/acknowledged-findings.json` (accept/reject)

### Appendix B — Real data snapshot (from `.sourcevision/`, structural pass, no LLM enrichment)

Files inventoried **1370** (403,813 lines) · zones **30** (+nested) · crossings **252** · findings **62** (info 45 / warning 17 / critical 0; anchors 0/62 — enrichment-gated) · classifications **571** (351 classified / 220 unclassified; all `algorithmic`) · import edges **3075** · call-graph **4512 fns / 132,451 edges**. Hench runs on disk **15** (mostly empty; 0 with event transcripts; prompts never persisted).
