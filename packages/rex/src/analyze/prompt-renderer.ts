/**
 * Verbosity-aware prompt rendering for rex LLM call sites.
 *
 * Wraps @n-dx/llm-client's renderPrompt with a module-level verbosity state so
 * every call site in the analyze pipeline automatically uses the configured
 * verbosity level without needing to pass it explicitly.
 *
 * ## Config key
 *
 * Verbosity is read from `prompts.verbosity` in `.n-dx.json` (the project-level
 * n-dx config overlay).  Valid values: `"compact"` (default) | `"verbose"`.
 *
 * Callers that run at process startup (CLI entry points) should call
 * `initPromptRenderer(verbosity)` after loading config.  Without explicit
 * initialisation the renderer defaults to `"compact"`, which is the correct
 * behaviour for all existing users.
 *
 * @module analyze/prompt-renderer
 */

import { renderPrompt } from "@n-dx/llm-client";
import type { PromptVerbosity } from "@n-dx/llm-client";

export type { PromptVerbosity } from "@n-dx/llm-client";

// ── Module-level verbosity state ─────────────────────────────────────────────

/**
 * Current verbosity level for rex LLM prompts.
 * Defaults to 'compact' — set once at process startup via initPromptRenderer.
 */
let _verbosity: PromptVerbosity = "compact";

/**
 * Initialise the prompt renderer with the resolved verbosity from config.
 * Call once at process startup (before any LLM calls) so all prompt builders
 * pick up the setting automatically.
 *
 * Config key: `prompts.verbosity` in `.n-dx.json`.
 */
export function initPromptRenderer(verbosity: PromptVerbosity): void {
  _verbosity = verbosity;
}

/**
 * Reset to the default ('compact').  Intended for test isolation.
 */
export function resetPromptRenderer(): void {
  _verbosity = "compact";
}

/** Return the current verbosity level. */
export function getPromptVerbosity(): PromptVerbosity {
  return _verbosity;
}

/**
 * Render a prompt template at the current verbosity level.
 * Convenience wrapper around renderPrompt that automatically passes
 * the module-level verbosity so call sites need not import it separately.
 *
 * Config key: `prompts.verbosity` (.n-dx.json)
 */
export function renderAtVerbosity(template: string): string {
  return renderPrompt(template, { verbosity: _verbosity });
}
