/**
 * Parallel-mode tool blocking for worktree-scoped MCP sessions.
 *
 * When a session is initialized with X-Ndx-Root-Dir (indicating a worktree-scoped
 * session for parallel execution), certain MCP tools are blocked to prevent
 * structural PRD modifications that could cause conflicts across worktrees.
 *
 * Blocked tools return a JSON error response with `isError: true` and a clear
 * message indicating the tool is unavailable in parallel mode.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Error code returned for parallel-mode restricted tools. */
export const PARALLEL_MODE_ERROR = "parallel_mode_restricted";

/**
 * Rex tools allowed in parallel (worktree-scoped) mode.
 *
 * Read-only tools and status-update tools are allowed. Structural mutation
 * tools (add, edit, move, merge, reorganize, etc.) are blocked.
 */
export const REX_PARALLEL_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "get_prd_status",   // read — PRD overview
  "get_next_task",    // read — next actionable task
  "update_task_status", // status transitions (in_progress, completed, failing)
  "get_item",         // read — item detail
  "append_log",       // append-only logging
  "health",           // read — health score
  "facets",           // read — facet overview/suggestions
  "get_capabilities", // read — server capabilities
]);

/**
 * Build the error message returned when a blocked tool is invoked.
 */
export function parallelModeErrorMessage(toolName: string): string {
  return JSON.stringify({
    error: PARALLEL_MODE_ERROR,
    message:
      `Tool "${toolName}" is unavailable in parallel mode. ` +
      `Worktree-scoped sessions restrict structural PRD modifications ` +
      `to prevent conflicts during parallel execution.`,
    tool: toolName,
  });
}

/**
 * Apply parallel-mode blocking to an MCP server instance.
 *
 * Replaces blocked tool handlers with error-returning stubs. The tool remains
 * visible in `listTools` responses (allowing the client to discover it), but
 * invoking it returns an `isError` response with a clear message.
 *
 * @param server - The MCP server instance (tools must be registered already).
 * @param allowedTools - Set of tool names that should remain functional.
 *        All other registered tools are replaced with error stubs.
 */
export function applyParallelModeBlocking(
  server: McpServer,
  allowedTools: ReadonlySet<string>,
): void {
  // _registeredTools is a plain object keyed by tool name → RegisteredTool.
  // Each RegisteredTool has an update() method that replaces the handler.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = (server as any)._registeredTools as Record<
    string,
    { update: (opts: { callback: () => unknown }) => void }
  >;

  for (const name of Object.keys(tools)) {
    if (!allowedTools.has(name)) {
      tools[name].update({
        callback: () => ({
          content: [{ type: "text" as const, text: parallelModeErrorMessage(name) }],
          isError: true,
        }),
      });
    }
  }
}
