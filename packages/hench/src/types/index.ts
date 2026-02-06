/**
 * Shared types and interfaces for the hench package.
 *
 * This module centralizes core types to prevent circular dependencies
 * between CLI and agent modules.
 */

import type { GuardRails } from "../guard/index.js";
import type { PRDStore } from "rex";

/**
 * Context passed to tool implementations during agent execution.
 */
export interface ToolContext {
  guard: GuardRails;
  projectDir: string;
  store: PRDStore;
  taskId: string;
  /** Test command for completion validation (from project config). */
  testCommand?: string;
  /** Commit hash captured before the agent started, for diffing against. */
  startingHead?: string;
}

/**
 * Result returned by tool implementations.
 * Tools return a string message describing the outcome.
 */
export type ToolResult = string;

// Re-export output utilities for convenient access
export {
  setQuiet,
  isQuiet,
  info,
  result,
  section,
  subsection,
  stream,
  detail,
} from "./output.js";
