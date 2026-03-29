/**
 * Unit tests for parallel-mode tool blocking.
 *
 * Verifies that applyParallelModeBlocking() correctly replaces blocked tool
 * handlers with error-returning stubs, while leaving allowed tools functional.
 */

import { describe, it, expect } from "vitest";
import {
  applyParallelModeBlocking,
  parallelModeErrorMessage,
  REX_PARALLEL_ALLOWED_TOOLS,
  PARALLEL_MODE_ERROR,
} from "../../../src/server/utils/parallel-mode.js";

// ── Mock MCP server ──────────────────────────────────────────────────────────

/**
 * Lightweight mock of McpServer._registeredTools for unit testing.
 * Each tool has an `update()` method that replaces its handler.
 */
function createMockServer(toolNames: string[]) {
  const tools: Record<string, {
    handler: () => unknown;
    update: (opts: { callback: () => unknown }) => void;
    enabled: boolean;
  }> = {};

  for (const name of toolNames) {
    const tool = {
      handler: () => ({ content: [{ type: "text", text: `${name} result` }] }),
      update(opts: { callback: () => unknown }) {
        if (opts.callback) tool.handler = opts.callback;
      },
      enabled: true,
    };
    tools[name] = tool;
  }

  // Simulate McpServer with _registeredTools
  return { _registeredTools: tools } as any;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("parallelModeErrorMessage", () => {
  it("returns JSON with error code and tool name", () => {
    const msg = parallelModeErrorMessage("add_item");
    const parsed = JSON.parse(msg);

    expect(parsed.error).toBe(PARALLEL_MODE_ERROR);
    expect(parsed.tool).toBe("add_item");
    expect(parsed.message).toContain("add_item");
    expect(parsed.message).toContain("parallel mode");
  });
});

describe("applyParallelModeBlocking", () => {
  const ALLOWED = new Set(["get_prd_status", "get_item", "update_task_status"]);

  it("does not modify allowed tools", () => {
    const server = createMockServer(["get_prd_status", "get_item", "add_item"]);

    applyParallelModeBlocking(server, ALLOWED);

    // Allowed tools keep their original handler
    const statusResult = server._registeredTools["get_prd_status"].handler() as any;
    expect(statusResult.content[0].text).toBe("get_prd_status result");
    expect(statusResult.isError).toBeUndefined();

    const itemResult = server._registeredTools["get_item"].handler() as any;
    expect(itemResult.content[0].text).toBe("get_item result");
  });

  it("replaces blocked tool handlers with error stubs", () => {
    const server = createMockServer(["get_prd_status", "add_item", "edit_item", "reorganize"]);

    applyParallelModeBlocking(server, ALLOWED);

    // Blocked tools return isError response
    for (const name of ["add_item", "edit_item", "reorganize"]) {
      const result = server._registeredTools[name].handler() as any;
      expect(result.isError).toBe(true);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe(PARALLEL_MODE_ERROR);
      expect(parsed.tool).toBe(name);
      expect(parsed.message).toContain("parallel mode");
    }
  });

  it("handles empty allowed set (all tools blocked)", () => {
    const server = createMockServer(["tool_a", "tool_b"]);

    applyParallelModeBlocking(server, new Set());

    for (const name of ["tool_a", "tool_b"]) {
      const result = server._registeredTools[name].handler() as any;
      expect(result.isError).toBe(true);
    }
  });

  it("handles case where all tools are allowed (no blocking)", () => {
    const server = createMockServer(["get_prd_status", "get_item"]);

    applyParallelModeBlocking(server, new Set(["get_prd_status", "get_item"]));

    // Both tools still work
    for (const name of ["get_prd_status", "get_item"]) {
      const result = server._registeredTools[name].handler() as any;
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe(`${name} result`);
    }
  });

  it("ignores tools in allowlist that are not registered", () => {
    const server = createMockServer(["add_item"]);
    const bigAllowlist = new Set(["get_prd_status", "get_item", "add_item", "not_registered"]);

    // Should not throw
    applyParallelModeBlocking(server, bigAllowlist);

    // add_item is in allowlist, should remain functional
    const result = server._registeredTools["add_item"].handler() as any;
    expect(result.isError).toBeUndefined();
  });
});

describe("REX_PARALLEL_ALLOWED_TOOLS", () => {
  it("includes read-only and status-update tools", () => {
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("get_prd_status")).toBe(true);
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("get_next_task")).toBe(true);
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("update_task_status")).toBe(true);
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("get_item")).toBe(true);
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("append_log")).toBe(true);
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("health")).toBe(true);
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("get_capabilities")).toBe(true);
  });

  it("excludes structural mutation tools", () => {
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("add_item")).toBe(false);
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("edit_item")).toBe(false);
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("move_item")).toBe(false);
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("merge_items")).toBe(false);
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("reorganize")).toBe(false);
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("get_recommendations")).toBe(false);
    expect(REX_PARALLEL_ALLOWED_TOOLS.has("sync_with_remote")).toBe(false);
  });
});
