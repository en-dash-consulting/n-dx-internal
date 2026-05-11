import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { cmdReshape } from "../../src/cli/commands/reshape.js";
import { resolveStore } from "../../src/store/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import { parseFolderTree } from "../../src/store/folder-tree-parser.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import type { PRDDocument, PRDItem } from "../../src/schema/index.js";

describe("reshape with cross-PRD duplicate detection", () => {
  let testDir: string;
  let rexDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `n-dx-test-reshape-${randomUUID()}`);
    rexDir = join(testDir, ".rex");
    await mkdir(rexDir, { recursive: true });

    // Initialize minimal config files
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({
        version: "0.4.0",
        prd: {
          schema: SCHEMA_VERSION,
          title: "Test PRD",
        },
      }),
    );
  });

  afterEach(async () => {
    if (testDir) {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  it("loads file ownership map from multiple PRD files", async () => {
    // Create two PRD documents with different items (no ID collisions)
    const prdMain: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Main PRD",
      items: [
        {
          id: "task1",
          title: "Implement Auth",
          level: "task",
          status: "pending",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
    };

    const prdFeature: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Feature PRD",
      items: [
        {
          id: "task2",
          title: "Fix bug",
          level: "task",
          status: "pending",
          createdAt: "2024-01-05T00:00:00Z",
          updatedAt: "2024-01-05T00:00:00Z",
        },
      ],
    };

    // Write both PRD files
    await writeFile(
      join(rexDir, "prd_main_2024-01-01.json"),
      toCanonicalJSON(prdMain),
    );
    await writeFile(
      join(rexDir, "prd_feature_2024-01-05.json"),
      toCanonicalJSON(prdFeature),
    );

    // Initialize store
    const store = await resolveStore(rexDir, { currentBranchFile: "prd_main_2024-01-01.json" });

    // Load file ownership map
    const fileOwnership = await store.loadFileOwnership();

    // Both items should be tracked
    expect(fileOwnership.get("task1")).toBe("prd_main_2024-01-01.json");
    expect(fileOwnership.get("task2")).toBe("prd_feature_2024-01-05.json");
  });

  it("identifies oldest PRD file for file age comparison", async () => {
    // Create three PRD documents with different dates
    const prdOld: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Old PRD",
      items: [
        {
          id: "task1",
          title: "Task A",
          level: "task",
          status: "pending",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
    };

    const prdMid: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Mid PRD",
      items: [
        {
          id: "task2",
          title: "Task B",
          level: "task",
          status: "pending",
          createdAt: "2024-01-05T00:00:00Z",
          updatedAt: "2024-01-05T00:00:00Z",
        },
      ],
    };

    const prdNew: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "New PRD",
      items: [
        {
          id: "task3",
          title: "Task C",
          level: "task",
          status: "pending",
          createdAt: "2024-01-10T00:00:00Z",
          updatedAt: "2024-01-10T00:00:00Z",
        },
      ],
    };

    // Write files in non-chronological order to verify date parsing
    await writeFile(join(rexDir, "prd_feature_2024-01-10.json"), toCanonicalJSON(prdNew));
    await writeFile(join(rexDir, "prd_main_2024-01-01.json"), toCanonicalJSON(prdOld));
    await writeFile(join(rexDir, "prd_hotfix_2024-01-05.json"), toCanonicalJSON(prdMid));

    // Initialize store
    const store = await resolveStore(rexDir);
    const fileOwnership = await store.loadFileOwnership();

    // Verify items are mapped to their correct files
    expect(fileOwnership.get("task1")).toBe("prd_main_2024-01-01.json");
    expect(fileOwnership.get("task2")).toBe("prd_hotfix_2024-01-05.json");
    expect(fileOwnership.get("task3")).toBe("prd_feature_2024-01-10.json");
  });

  it("handles legacy prd.json as oldest file", async () => {
    // Create a legacy prd.json and a dated PRD file
    const prdLegacy: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Legacy PRD",
      items: [
        {
          id: "task1",
          title: "Legacy Task",
          level: "task",
          status: "pending",
          createdAt: "2020-01-01T00:00:00Z",
          updatedAt: "2020-01-01T00:00:00Z",
        },
      ],
    };

    const prdDated: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Dated PRD",
      items: [
        {
          id: "task2",
          title: "New Task",
          level: "task",
          status: "pending",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
    };

    // Write files
    await writeFile(join(rexDir, "prd.json"), toCanonicalJSON(prdLegacy)); // legacy, no date
    await writeFile(join(rexDir, "prd_main_2024-01-01.json"), toCanonicalJSON(prdDated));

    // Initialize store
    const store = await resolveStore(rexDir);
    const fileOwnership = await store.loadFileOwnership();

    // Legacy prd.json items should be in the map
    expect(fileOwnership.get("task1")).toBe("prd.json");
    expect(fileOwnership.get("task2")).toBe("prd_main_2024-01-01.json");
  });
});
