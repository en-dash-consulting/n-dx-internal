import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { serializeFolderTree } from "../../../../src/store/index.js";
import { cmdTree } from "../../../../src/cli/commands/tree.js";
import { resetColorCache } from "@n-dx/llm-client";
import type { PRDDocument, PRDItem } from "../../../../src/schema/index.js";

function writePRD(dir: string, doc: PRDDocument): void {
  writeFileSync(join(dir, ".rex", "prd.json"), JSON.stringify(doc));
}

function writeConfig(dir: string, config: Record<string, unknown>): void {
  writeFileSync(join(dir, ".rex", "config.json"), JSON.stringify(config));
}

const POPULATED_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Test Project",
  items: [
    {
      id: "e1",
      title: "Auth System",
      level: "epic",
      status: "in_progress",
      priority: "high",
      children: [
        {
          id: "f1",
          title: "OAuth Flow",
          level: "feature",
          status: "in_progress",
          children: [
            {
              id: "t1",
              title: "Token Exchange",
              level: "task",
              status: "completed",
              priority: "critical",
            },
            {
              id: "t2",
              title: "Refresh Logic",
              level: "task",
              status: "pending",
            },
          ],
        },
        {
          id: "f2",
          title: "Session Store",
          level: "feature",
          status: "deferred",
        },
      ],
    },
    {
      id: "e2",
      title: "Dashboard",
      level: "epic",
      status: "pending",
    },
  ],
};

describe("cmdTree", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "rex-tree-test-"));
    mkdirSync(join(testDir, ".rex"), { recursive: true });
    writePRD(testDir, POPULATED_PRD);
    writeConfig(testDir, {});
    resetColorCache();
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    resetColorCache();
  });

  it("renders tree with all items visible", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => {
      output.push(msg);
    });

    try {
      await cmdTree(testDir, {});

      // Should include all items
      const fullOutput = output.join("\n");
      expect(fullOutput).toContain("Auth System");
      expect(fullOutput).toContain("OAuth Flow");
      expect(fullOutput).toContain("Token Exchange");
      expect(fullOutput).toContain("Refresh Logic");
      expect(fullOutput).toContain("Session Store");
      expect(fullOutput).toContain("Dashboard");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("renders in-progress items with ** markers when color is enabled", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => {
      output.push(msg);
    });

    // Simulate TTY for color output
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });

    try {
      resetColorCache();
      await cmdTree(testDir, {});

      const fullOutput = output.join("\n");
      // In-progress items should have ** markers (even with color applied)
      expect(fullOutput).toMatch(/\*\*Auth System\*\*/);
      expect(fullOutput).toMatch(/\*\*OAuth Flow\*\*/);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
      vi.restoreAllMocks();
      resetColorCache();
    }
  });

  it("respects NO_COLOR environment variable", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => {
      output.push(msg);
    });

    const originalNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";

    try {
      resetColorCache();
      await cmdTree(testDir, {});

      const fullOutput = output.join("\n");
      // ** markers should still be present even with NO_COLOR
      expect(fullOutput).toContain("**Auth System**");
      expect(fullOutput).toContain("**OAuth Flow**");

      // Should not contain ANSI color codes
      expect(fullOutput).not.toMatch(/\x1b\[/);
    } finally {
      process.env.NO_COLOR = originalNoColor;
      vi.restoreAllMocks();
      resetColorCache();
    }
  });

  it("includes status icons in output", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => {
      output.push(msg);
    });

    try {
      await cmdTree(testDir, {});

      const fullOutput = output.join("\n");
      // Should contain status icons
      expect(fullOutput).toMatch(/●|◐|○/); // completed, in_progress, pending icons
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("includes priority markers where appropriate", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => {
      output.push(msg);
    });

    try {
      await cmdTree(testDir, {});

      const fullOutput = output.join("\n");
      // Should include priority markers [high] and [critical]
      expect(fullOutput).toContain("[high]");
      expect(fullOutput).toContain("[critical]");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("filters deleted items", async () => {
    const prdWithDeleted: PRDDocument = {
      ...POPULATED_PRD,
      items: [
        ...POPULATED_PRD.items,
        {
          id: "e3",
          title: "Deleted Epic",
          level: "epic",
          status: "deleted",
        },
      ],
    };

    writePRD(testDir, prdWithDeleted);

    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => {
      output.push(msg);
    });

    try {
      await cmdTree(testDir, {});

      const fullOutput = output.join("\n");
      // Should not contain deleted items
      expect(fullOutput).not.toContain("Deleted Epic");
      // But should still contain other items
      expect(fullOutput).toContain("Auth System");
    } finally {
      vi.restoreAllMocks();
    }
  });
});
