/**
 * LLM selection logic for `ndx init`.
 *
 * Extracted from cli.js to keep handleInit() focused on orchestration.
 * This module owns the resolution logic that determines whether to prompt
 * or use existing values. The actual prompting is handled by the caller.
 *
 * ## Tier
 *
 * Orchestration — same rules as cli.js: no package imports, only node: builtins.
 *
 * ## Precedence
 *
 * 1. Explicit CLI flags (--provider=, --model=)
 * 2. Existing project config (.n-dx.json)
 * 3. Interactive prompt (TTY only)
 * 4. Runtime default fallback (handled by caller)
 */

const SUPPORTED_PROVIDERS = ["codex", "claude"];

/**
 * Resolve LLM provider and model selection for `ndx init`.
 *
 * Pure decision logic — no I/O, no prompting. Returns what is known and
 * signals what still needs prompting so the caller can drive the UI.
 *
 * @param {object} options
 * @param {object} options.flags             Parsed CLI flags
 * @param {string} [options.flags.provider]  --provider= value
 * @param {string} [options.flags.model]     --model= value
 * @param {object} options.existingConfig    Values read from .n-dx.json
 * @param {string} [options.existingConfig.vendor]  llm.vendor
 * @param {string} [options.existingConfig.model]   llm.<vendor>.model
 * @param {boolean} options.isTTY            Whether stdin is a TTY (prompts allowed)
 *
 * @returns {{
 *   provider?: string,
 *   model?: string,
 *   providerSource?: "flag" | "config",
 *   modelSource?: "flag" | "config",
 *   needsProviderPrompt: boolean,
 *   needsModelPrompt: boolean,
 * }}
 */
export function resolveInitLLMSelection({ flags, existingConfig, isTTY }) {
  const result = {
    provider: undefined,
    model: undefined,
    providerSource: undefined,
    modelSource: undefined,
    needsProviderPrompt: false,
    needsModelPrompt: false,
  };

  // ── Step 1: Resolve provider ───────────────────────────────────────────

  if (flags.provider) {
    result.provider = flags.provider;
    result.providerSource = "flag";
  } else if (existingConfig.vendor) {
    result.provider = existingConfig.vendor;
    result.providerSource = "config";
  }
  // else: provider unknown — may need prompting

  // ── Step 2: Resolve model ──────────────────────────────────────────────

  if (flags.model) {
    result.model = flags.model;
    result.modelSource = "flag";
  } else if (result.provider && existingConfig.model && existingConfig.vendor === result.provider) {
    // Only carry over existing model when the provider hasn't changed.
    // Switching vendors (e.g. flag says codex but config had claude) means
    // the old model is irrelevant.
    result.model = existingConfig.model;
    result.modelSource = "config";
  }
  // else: model unknown — may need prompting

  // ── Step 3: Determine what still needs prompting ───────────────────────

  if (!result.provider) {
    result.needsProviderPrompt = isTTY;
    // If we don't know the provider, we also don't know the model
    result.needsModelPrompt = isTTY;
  } else if (!result.model) {
    result.needsModelPrompt = isTTY;
  }

  return result;
}

export { SUPPORTED_PROVIDERS };
