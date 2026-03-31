/**
 * Assistant-neutral setup orchestration — provisions supported assistant
 * surfaces (Claude, Codex) without coupling the init flow to any
 * single vendor.
 *
 * cli.js delegates to `setupAssistantIntegrations()` during init, which
 * dispatches to vendor-specific integrations via a registry.  Adding a
 * new vendor is a matter of adding an entry to `VENDOR_REGISTRY` and a
 * corresponding `<vendor>-integration.js` module — no changes to the
 * init control flow are required.
 *
 * @module n-dx/assistant-integration
 */

import { setupClaudeIntegration } from "./claude-integration.js";
import { setupCodexIntegration } from "./codex-integration.js";

// ── Vendor registry ──────────────────────────────────────────────────────────

/**
 * Each entry maps a vendor name to its setup function and a one-line
 * summary formatter.  The registry is the single place where vendor
 * dispatch is defined — handleInit() never mentions vendor names
 * directly (except to build the options object from CLI flags).
 */
const VENDOR_REGISTRY = {
  claude: {
    setup: setupClaudeIntegration,
    summarize: (r) =>
      `CLAUDE.md, ${r.skills.written} skills, ${r.settings.total} permissions`,
  },
  codex: {
    setup: setupCodexIntegration,
    summarize: (r) =>
      `AGENTS.md, ${r.skills.written} skills, ${r.config.serverCount} MCP servers`,
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the list of vendor names known to the registry.
 *
 * @returns {string[]}
 */
export function getSupportedAssistants() {
  return Object.keys(VENDOR_REGISTRY);
}

/**
 * Provision all enabled assistant surfaces in a single call.
 *
 * Each vendor is set up independently — a failure in one does not
 * prevent the other from completing.  Failures are captured as
 * `"skipped"` summaries rather than thrown.
 *
 * @param {string} dir  Project root directory
 * @param {Record<string, boolean>} [enabled]
 *   Map of vendor names to enabled flags.  Vendors not present default
 *   to `true` (enabled).  Pass `{ claude: false }` to skip Claude, etc.
 * @returns {Record<string, { summary: string, detail?: object }>}
 *   Per-vendor result keyed by vendor name.
 */
export function setupAssistantIntegrations(dir, enabled = {}) {
  const results = {};

  for (const [vendor, entry] of Object.entries(VENDOR_REGISTRY)) {
    const isEnabled = enabled[vendor] !== false;

    if (!isEnabled) {
      results[vendor] = { summary: "skipped" };
      continue;
    }

    try {
      const detail = entry.setup(dir);
      results[vendor] = {
        summary: entry.summarize(detail),
        detail,
      };
    } catch {
      results[vendor] = { summary: "skipped" };
    }
  }

  return results;
}
