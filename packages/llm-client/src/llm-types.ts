/**
 * Vendor-neutral LLM client types.
 *
 * These types define the forward-looking contract for multi-vendor support
 * while keeping the existing Claude-specific contract available for
 * backward compatibility during migration.
 *
 * ## Dependency note
 *
 * This module imports only from foundational leaf modules (`types.ts`,
 * `provider-interface.ts`). Factory-level types such as
 * `CreateLLMClientOptions` live in `llm-client.ts` alongside the factory
 * function they parameterise, keeping this file free of implementation
 * dependencies.
 */

import type { ClaudeClient, ClaudeConfig } from "./types.js";

// LLMVendor is defined in provider-interface.ts (its natural home as part of
// the provider contract). Re-exported here so consumers can import it from
// the vendor-neutral types module without knowing its origin.
import type { LLMVendor } from "./provider-interface.js";
export type { LLMVendor };

/**
 * Task weight for model tier selection.
 *
 * - `light` — simple classification and other explicitly low-complexity work
 * - `standard` — multi-turn agents, deep analysis, full-capability tasks
 * - `heavy` — maximum capability: complex reasoning, long-horizon tasks
 *
 * Used by `resolveVendorModel()` to select the appropriate model tier.
 * When omitted, defaults to 'standard' for backward compatibility.
 */
export type TaskWeight = "light" | "standard" | "heavy";

/** Optional Codex-specific config section in `.n-dx.json`. */
export interface CodexConfig {
  /** Path to Codex CLI binary. Defaults to `codex`. */
  cli_path?: string;
  /** API key used by future Codex API providers. */
  api_key?: string;
  /** Optional custom API endpoint. */
  api_endpoint?: string;
  /** Default model for Codex requests. */
  model?: string;
  /**
   * Model override for the 'light' task weight tier.
   * When set, resolveVendorModel uses this model for light-weight tasks
   * instead of TIER_MODELS.codex.light.
   */
  lightModel?: string;
}

/** Optional Google Gemini-specific config section in `.n-dx.json`. */
export interface GoogleConfig {
  /** Google API key (from Google AI Studio or GCP). */
  api_key?: string;
  /** Custom API endpoint base URL. When set, overrides the default Gemini URL. */
  api_endpoint?: string;
  /** Default Gemini model ID (e.g. `"gemini-2.5-pro"`). */
  model?: string;
  /**
   * Model override for the 'light' task weight tier.
   * When set, resolveVendorModel uses this model for light-weight tasks
   * instead of TIER_MODELS.google.light.
   */
  lightModel?: string;
  /**
   * Environment variable name for the Google API key.
   * Defaults to `"GEMINI_API_KEY"` when not set.
   * Override to use a custom env var name (e.g. `"MY_GOOGLE_KEY"`).
   */
  apiKeyEnv?: string;
  /**
   * Google OAuth2 client ID for the installed-app credential flow.
   * Required for `ndx auth google`. Obtain from Google Cloud Console
   * under APIs & Services → Credentials → OAuth 2.0 Client IDs
   * (Application type: Desktop app).
   * Can also be supplied via the `GOOGLE_CLIENT_ID` environment variable.
   */
  client_id?: string;
  /**
   * Google OAuth2 client secret for the installed-app credential flow.
   * Required for `ndx auth google` and automatic token refresh.
   * Can also be supplied via the `GOOGLE_CLIENT_SECRET` environment variable.
   */
  client_secret?: string;
  /**
   * Override path for the OAuth2 credential file.
   * Defaults to `~/.config/n-dx/google-credentials.json` (XDG-aware).
   * Can also be set via the `GOOGLE_CREDENTIALS_PATH` environment variable.
   */
  oauth_credentials_path?: string;
}

/**
 * Minimum default LLM response timeout (5 minutes in milliseconds).
 *
 * All vendor adapters (Claude, Codex, Google) use this as their floor when no
 * explicit timeout is configured. Users can raise it via `llm.responseTimeout`
 * in `.n-dx.json` — this constant is a default, not a cap.
 */
export const DEFAULT_LLM_RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;

/** Vendor-neutral config shape loaded from `.n-dx.json`. */
export interface LLMConfig {
  /** Default vendor selected by the project. */
  vendor?: LLMVendor;
  /**
   * Top-level model override for the active vendor. When set, this wins over
   * `claude.model`/`codex.model` so users can switch the active model with a
   * single edit without having to clear the vendor-pinned slot written by
   * `ndx init`.
   */
  model?: string;
  /** Claude-specific config (legacy + active). */
  claude?: ClaudeConfig;
  /** Codex-specific config (reserved for adapter integration). */
  codex?: CodexConfig;
  /** Google Gemini-specific config. */
  google?: GoogleConfig;
  /**
   * Enable automatic failover on model/vendor errors.
   * When true, hench retries failed runs on fallback models before surfacing errors.
   * Default: false (disabled for backward compatibility).
   */
  autoFailover?: boolean;
  /**
   * LLM response timeout for all vendor adapters, in milliseconds.
   *
   * Overrides the adapter's built-in default ({@link DEFAULT_LLM_RESPONSE_TIMEOUT_MS}).
   * Must be ≥ 1. The 5-minute constant is the floor for adapters — this field
   * can raise it above the default but is not validated as a hard cap.
   *
   * @default 300_000 (5 minutes)
   */
  responseTimeout?: number;
}

/** Alias that preserves migration ergonomics for downstream packages. */
export type LLMClient = ClaudeClient;
