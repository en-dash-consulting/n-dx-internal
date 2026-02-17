/**
 * Help navigation, typo correction, and search utilities for n-dx CLI.
 *
 * Provides:
 *   - Hierarchical navigation with drill-down hints
 *   - Typo correction via Levenshtein edit distance
 *   - Keyword search across all help content with relevance scoring
 *   - Related command suggestions ("See also")
 *
 * @module n-dx/help
 */

// ── Command registry ────────────────────────────────────────────────────

/**
 * @typedef {Object} CommandEntry
 * @property {string} name - Command name
 * @property {string} category - Category grouping (e.g. "Orchestration", "Tools")
 * @property {string} summary - One-line description
 * @property {string[]} keywords - Search keywords
 * @property {string[]} related - Names of related commands
 * @property {string} [parent] - Parent tool for subcommands (e.g. "rex")
 */

/** @type {CommandEntry[]} */
const COMMAND_REGISTRY = [
  // ── Orchestration commands ──
  {
    name: "init",
    category: "Orchestration",
    summary: "Initialize all tools (sourcevision + rex + hench)",
    keywords: ["setup", "create", "bootstrap", "initialize", "project", "start"],
    related: ["plan", "status"],
  },
  {
    name: "plan",
    category: "Orchestration",
    summary: "Analyze codebase and generate PRD proposals",
    keywords: ["analyze", "PRD", "proposals", "codebase", "scan", "guided", "import", "spec"],
    related: ["init", "work", "status"],
  },
  {
    name: "work",
    category: "Orchestration",
    summary: "Execute the next task autonomously with hench agent",
    keywords: ["run", "execute", "agent", "task", "autonomous", "hench", "loop", "epic"],
    related: ["plan", "status"],
  },
  {
    name: "status",
    category: "Orchestration",
    summary: "Show PRD status tree with completion stats",
    keywords: ["PRD", "tree", "progress", "completion", "stats", "overview"],
    related: ["plan", "usage", "work"],
  },
  {
    name: "usage",
    category: "Orchestration",
    summary: "Token usage analytics and cost estimation",
    keywords: ["tokens", "cost", "analytics", "LLM", "consumption", "billing"],
    related: ["status"],
  },
  {
    name: "sync",
    category: "Orchestration",
    summary: "Sync local PRD with remote adapter (e.g. Notion)",
    keywords: ["remote", "Notion", "push", "pull", "bidirectional", "adapter"],
    related: ["status"],
  },
  {
    name: "start",
    category: "Orchestration",
    summary: "Start dashboard and MCP server",
    keywords: ["server", "web", "dashboard", "MCP", "HTTP", "background", "daemon"],
    related: ["web", "dev"],
  },
  {
    name: "dev",
    category: "Orchestration",
    summary: "Start dev server with live reload",
    keywords: ["development", "HMR", "hot reload", "server"],
    related: ["start"],
  },
  {
    name: "web",
    category: "Orchestration",
    summary: "Alias for start (legacy)",
    keywords: ["server", "dashboard", "MCP"],
    related: ["start"],
  },
  {
    name: "ci",
    category: "Orchestration",
    summary: "Run analysis pipeline and validate PRD health",
    keywords: ["CI", "pipeline", "validation", "health", "continuous integration"],
    related: ["plan", "status"],
  },
  {
    name: "config",
    category: "Orchestration",
    summary: "View and edit settings across all packages",
    keywords: ["settings", "configuration", "preferences", "edit", "view"],
    related: [],
  },
  // ── Tool delegation commands ──
  {
    name: "rex",
    category: "Tools",
    summary: "PRD management and task tracking",
    keywords: ["PRD", "tasks", "epics", "features", "management", "tracking"],
    related: ["hench", "sourcevision"],
  },
  {
    name: "hench",
    category: "Tools",
    summary: "Autonomous agent for task execution",
    keywords: ["agent", "autonomous", "execution", "Claude", "AI"],
    related: ["rex", "work"],
  },
  {
    name: "sourcevision",
    category: "Tools",
    summary: "Codebase analysis and visualization",
    keywords: ["analysis", "codebase", "static", "zones", "imports", "inventory"],
    related: ["rex", "plan"],
  },
  {
    name: "sv",
    category: "Tools",
    summary: "Alias for sourcevision",
    keywords: ["analysis", "codebase", "sourcevision"],
    related: ["sourcevision"],
  },
];

// ── Subcommand registries (for search across tool subcommands) ──────────

/** @type {Record<string, CommandEntry[]>} */
const SUBCOMMAND_REGISTRY = {
  rex: [
    { name: "init", parent: "rex", category: "Rex", summary: "Initialize .rex/ directory", keywords: ["setup", "create"], related: ["status", "analyze"] },
    { name: "status", parent: "rex", category: "Rex", summary: "Show PRD tree with completion stats", keywords: ["PRD", "tree", "progress"], related: ["next", "usage"] },
    { name: "next", parent: "rex", category: "Rex", summary: "Print next actionable task", keywords: ["task", "priority", "actionable"], related: ["status", "update"] },
    { name: "add", parent: "rex", category: "Rex", summary: "Add items to the PRD (manual or smart LLM mode)", keywords: ["create", "epic", "feature", "task", "subtask", "LLM", "smart"], related: ["analyze", "update"] },
    { name: "update", parent: "rex", category: "Rex", summary: "Update item status, priority, or title", keywords: ["modify", "change", "complete", "status"], related: ["add", "next"] },
    { name: "move", parent: "rex", category: "Rex", summary: "Reparent an item in the PRD tree", keywords: ["reparent", "hierarchy", "reorganize"], related: ["reshape"] },
    { name: "reshape", parent: "rex", category: "Rex", summary: "LLM-powered PRD restructuring", keywords: ["restructure", "merge", "split", "reorganize", "LLM"], related: ["prune", "move"] },
    { name: "prune", parent: "rex", category: "Rex", summary: "Remove completed subtrees", keywords: ["clean", "archive", "completed", "consolidate"], related: ["reshape", "status"] },
    { name: "validate", parent: "rex", category: "Rex", summary: "Check PRD integrity (DAG, schema)", keywords: ["check", "integrity", "schema", "DAG", "health"], related: ["fix", "report"] },
    { name: "fix", parent: "rex", category: "Rex", summary: "Auto-fix common PRD issues", keywords: ["repair", "timestamps", "references", "auto-fix"], related: ["validate"] },
    { name: "sync", parent: "rex", category: "Rex", summary: "Sync PRD with remote adapter", keywords: ["remote", "Notion", "push", "pull"], related: ["adapter"] },
    { name: "usage", parent: "rex", category: "Rex", summary: "Token usage analytics", keywords: ["tokens", "cost", "analytics"], related: ["status"] },
    { name: "report", parent: "rex", category: "Rex", summary: "Generate JSON health report", keywords: ["health", "CI", "JSON", "dashboard"], related: ["validate"] },
    { name: "verify", parent: "rex", category: "Rex", summary: "Run tests for acceptance criteria", keywords: ["test", "acceptance", "criteria", "coverage"], related: ["status"] },
    { name: "recommend", parent: "rex", category: "Rex", summary: "Get SourceVision-based recommendations", keywords: ["recommendations", "suggestions", "sourcevision"], related: ["analyze"] },
    { name: "analyze", parent: "rex", category: "Rex", summary: "Build PRD from project analysis", keywords: ["scan", "codebase", "proposals", "LLM", "import"], related: ["add", "recommend"] },
    { name: "adapter", parent: "rex", category: "Rex", summary: "Manage store adapters (list, add, remove, show)", keywords: ["Notion", "remote", "configure"], related: ["sync"] },
    { name: "mcp", parent: "rex", category: "Rex", summary: "Start MCP server for AI tool integration", keywords: ["MCP", "Claude", "AI", "tools"], related: [] },
  ],
  hench: [
    { name: "init", parent: "hench", category: "Hench", summary: "Create .hench/ with default configuration", keywords: ["setup", "create"], related: ["run", "config"] },
    { name: "run", parent: "hench", category: "Hench", summary: "Execute a task from the Rex PRD", keywords: ["execute", "task", "agent", "Claude", "autonomous", "loop"], related: ["status", "show"] },
    { name: "status", parent: "hench", category: "Hench", summary: "Show recent run history", keywords: ["history", "runs", "recent"], related: ["show", "run"] },
    { name: "show", parent: "hench", category: "Hench", summary: "Show full details of a specific run", keywords: ["details", "run", "tokens", "timing"], related: ["status"] },
    { name: "config", parent: "hench", category: "Hench", summary: "View or edit workflow configuration", keywords: ["settings", "model", "provider", "configuration"], related: ["template"] },
    { name: "template", parent: "hench", category: "Hench", summary: "Manage workflow templates", keywords: ["templates", "presets", "workflow", "save", "apply"], related: ["config"] },
  ],
  sourcevision: [
    { name: "init", parent: "sourcevision", category: "SourceVision", summary: "Set up .sourcevision/ directory", keywords: ["setup", "create"], related: ["analyze"] },
    { name: "analyze", parent: "sourcevision", category: "SourceVision", summary: "Run the analysis pipeline", keywords: ["inventory", "imports", "zones", "components", "scan"], related: ["validate", "serve"] },
    { name: "serve", parent: "sourcevision", category: "SourceVision", summary: "Start local viewer server", keywords: ["server", "viewer", "browse"], related: ["analyze"] },
    { name: "validate", parent: "sourcevision", category: "SourceVision", summary: "Validate analysis output files", keywords: ["check", "integrity", "CI"], related: ["analyze"] },
    { name: "reset", parent: "sourcevision", category: "SourceVision", summary: "Remove .sourcevision/ and start fresh", keywords: ["clean", "delete", "fresh"], related: ["init"] },
    { name: "export-pdf", parent: "sourcevision", category: "SourceVision", summary: "Export analysis as PDF report", keywords: ["PDF", "report", "export"], related: ["analyze"] },
    { name: "mcp", parent: "sourcevision", category: "SourceVision", summary: "Start MCP server for AI tool integration", keywords: ["MCP", "Claude", "AI", "tools"], related: [] },
  ],
};

// ── Levenshtein edit distance ──────────────────────────────────────────

/**
 * Compute Levenshtein edit distance between two strings.
 * Used for typo correction — suggests commands within distance ≤ 2.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  const m = a.length;
  const n = b.length;

  // Optimize: short-circuit obvious cases
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single-row DP for memory efficiency
  const prev = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = prev[j];
      if (a[i - 1] === b[j - 1]) {
        prev[j] = prevDiag;
      } else {
        prev[j] = 1 + Math.min(prevDiag, prev[j - 1], prev[j]);
      }
      prevDiag = temp;
    }
  }

  return prev[n];
}

/**
 * Find the closest command names to the given input using edit distance.
 * Returns suggestions sorted by distance, filtered to distance ≤ maxDistance.
 *
 * @param {string} input - The mistyped command
 * @param {string[]} candidates - Valid command names
 * @param {number} [maxDistance=2] - Maximum edit distance to include
 * @returns {{ name: string, distance: number }[]}
 */
export function suggestCommands(input, candidates, maxDistance = 2) {
  const lower = input.toLowerCase();
  return candidates
    .map((name) => ({ name, distance: editDistance(lower, name.toLowerCase()) }))
    .filter((s) => s.distance > 0 && s.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Format a "Did you mean?" suggestion string for CLI output.
 *
 * @param {string} input - The mistyped command
 * @param {string[]} candidates - Valid command names
 * @param {string} [prefix=""] - Command prefix (e.g. "ndx ", "rex ")
 * @returns {string | null} - Formatted suggestion or null if no matches
 */
export function formatTypoSuggestion(input, candidates, prefix = "") {
  const suggestions = suggestCommands(input, candidates);
  if (suggestions.length === 0) return null;

  if (suggestions.length === 1) {
    return `Did you mean '${prefix}${suggestions[0].name}'?`;
  }

  const names = suggestions.slice(0, 3).map((s) => `${prefix}${s.name}`);
  return `Did you mean one of: ${names.join(", ")}?`;
}

// ── Search ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SearchResult
 * @property {string} name - Command name (e.g. "status" or "rex status")
 * @property {string} category - Category label
 * @property {string} summary - One-line description
 * @property {number} score - Relevance score (higher is better)
 * @property {string[]} matchReasons - What matched (e.g. "name", "keyword", "summary")
 */

/**
 * Search all help content for commands matching a keyword query.
 * Scores results by relevance: name match (10) > keyword match (5) > summary match (2).
 *
 * @param {string} query - Search query (case-insensitive)
 * @returns {SearchResult[]} - Results sorted by score descending
 */
export function searchHelp(query) {
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  /** @type {SearchResult[]} */
  const results = [];

  /**
   * Score a command entry against the query.
   * @param {CommandEntry} entry
   * @param {string} displayName
   */
  function scoreEntry(entry, displayName) {
    let score = 0;
    const matchReasons = [];

    // Name match (exact or partial)
    if (entry.name.toLowerCase() === lower) {
      score += 15;
      matchReasons.push("exact name match");
    } else if (entry.name.toLowerCase().includes(lower)) {
      score += 10;
      matchReasons.push("name");
    }

    // Keyword matches
    for (const kw of entry.keywords) {
      const kwLower = kw.toLowerCase();
      for (const word of words) {
        if (kwLower === word) {
          score += 5;
          matchReasons.push(`keyword: ${kw}`);
        } else if (kwLower.includes(word) || word.includes(kwLower)) {
          score += 3;
          matchReasons.push(`keyword: ${kw}`);
        }
      }
    }

    // Summary match
    const summaryLower = entry.summary.toLowerCase();
    for (const word of words) {
      if (summaryLower.includes(word)) {
        score += 2;
        matchReasons.push("summary");
      }
    }

    // Category match
    if (entry.category.toLowerCase().includes(lower)) {
      score += 1;
      matchReasons.push("category");
    }

    if (score > 0) {
      results.push({
        name: displayName,
        category: entry.category,
        summary: entry.summary,
        score,
        matchReasons: [...new Set(matchReasons)],
      });
    }
  }

  // Score top-level commands
  for (const entry of COMMAND_REGISTRY) {
    scoreEntry(entry, entry.name);
  }

  // Score subcommands
  for (const [tool, subs] of Object.entries(SUBCOMMAND_REGISTRY)) {
    for (const entry of subs) {
      scoreEntry(entry, `${tool} ${entry.name}`);
    }
  }

  // Deduplicate: if a command appears as both top-level and subcommand, keep the higher score
  const deduped = new Map();
  for (const r of results) {
    const existing = deduped.get(r.name);
    if (!existing || r.score > existing.score) {
      deduped.set(r.name, r);
    }
  }

  return [...deduped.values()].sort((a, b) => b.score - a.score);
}

/**
 * Format search results for CLI output.
 *
 * @param {SearchResult[]} results
 * @param {string} query
 * @returns {string}
 */
export function formatSearchResults(results, query) {
  if (results.length === 0) {
    return `No commands found matching '${query}'.

Try 'ndx --help' to see all available commands.`;
  }

  const lines = [`Search results for '${query}':\n`];

  for (const r of results.slice(0, 10)) {
    const prefix = r.name.includes(" ") ? "ndx " : "ndx ";
    lines.push(`  ${prefix}${r.name}`);
    lines.push(`    ${r.summary}`);
  }

  if (results.length > 10) {
    lines.push(`\n  ... and ${results.length - 10} more results`);
  }

  lines.push(`\nRun 'ndx <command> --help' for detailed help on a specific command.`);

  return lines.join("\n");
}

// ── Related commands ──────────────────────────────────────────────────

/**
 * Get related command names for a given command.
 *
 * @param {string} command - Command name
 * @param {string} [tool] - Optional tool scope (e.g. "rex")
 * @returns {string[]}
 */
export function getRelatedCommands(command, tool) {
  if (tool && SUBCOMMAND_REGISTRY[tool]) {
    const entry = SUBCOMMAND_REGISTRY[tool].find((e) => e.name === command);
    if (entry) return entry.related;
  }

  const entry = COMMAND_REGISTRY.find((e) => e.name === command);
  return entry ? entry.related : [];
}

/**
 * Format a "See also" line for related commands.
 *
 * @param {string[]} related - Related command names
 * @param {string} [prefix="ndx"] - Command prefix
 * @returns {string | null}
 */
export function formatRelatedCommands(related, prefix = "ndx") {
  if (related.length === 0) return null;
  return `See also: ${related.map((r) => `${prefix} ${r}`).join(", ")}`;
}

// ── Navigation helpers ────────────────────────────────────────────────

/**
 * Get all valid command names for the orchestrator.
 * @returns {string[]}
 */
export function getOrchestratorCommands() {
  return COMMAND_REGISTRY.map((e) => e.name);
}

/**
 * Get all valid subcommand names for a tool.
 * @param {string} tool - Tool name (rex, hench, sourcevision)
 * @returns {string[]}
 */
export function getToolSubcommands(tool) {
  const registry = SUBCOMMAND_REGISTRY[tool] || SUBCOMMAND_REGISTRY[tool === "sv" ? "sourcevision" : tool];
  return registry ? registry.map((e) => e.name) : [];
}

/**
 * Format tool-specific help showing its subcommands with drill-down hints.
 *
 * @param {string} tool - Tool name
 * @returns {string | null}
 */
export function formatToolHelp(tool) {
  const normalizedTool = tool === "sv" ? "sourcevision" : tool;
  const subs = SUBCOMMAND_REGISTRY[normalizedTool];
  if (!subs) return null;

  const toolLabels = { rex: "Rex", hench: "Hench", sourcevision: "SourceVision" };
  const label = toolLabels[normalizedTool] || normalizedTool;

  const lines = [`${label} — available commands:\n`];

  for (const entry of subs) {
    const padded = entry.name.padEnd(16);
    lines.push(`  ${padded}${entry.summary}`);
  }

  lines.push(`\nRun '${tool} <command> --help' for detailed help on a specific command.`);

  return lines.join("\n");
}
