import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PRDDocument } from "../../../../src/schema/index.js";

async function writeFixtureProject(dir: string): Promise<void> {
  await mkdir(join(dir, ".rex"), { recursive: true });
  await mkdir(join(dir, ".sourcevision"), { recursive: true });

  await writeFile(
    join(dir, ".rex", "config.json"),
    JSON.stringify({
      schema: "rex/v1",
      project: "test-project",
      adapter: "file",
    }),
    "utf-8",
  );

  await writeFile(
    join(dir, ".rex", "prd.json"),
    JSON.stringify({
      schema: "rex/v1",
      title: "test-project",
      items: [],
    }),
    "utf-8",
  );

  await writeFile(
    join(dir, ".sourcevision", "zones.json"),
    JSON.stringify({
      findings: [
        { severity: "warning", category: "auth", message: "Auth finding A" },
        { severity: "warning", category: "perf", message: "Perf finding A" },
        { severity: "warning", category: "security", message: "Security finding A" },
        { severity: "critical", category: "auth", message: "Auth finding B" },
      ],
    }),
    "utf-8",
  );
}

async function readPrdItems(dir: string): Promise<PRDDocument["items"]> {
  const raw = await readFile(join(dir, ".rex", "prd.json"), "utf-8");
  const doc = JSON.parse(raw) as PRDDocument;
  return doc.items;
}

async function writeFindings(
  dir: string,
  findings: Array<{ severity: string; category: string; message: string }>,
): Promise<void> {
  await writeFile(
    join(dir, ".sourcevision", "zones.json"),
    JSON.stringify({ findings }),
    "utf-8",
  );
}

describe("cmdRecommend --accept indexed selection", () => {
  let tmpDir: string;
  let cmdRecommend: typeof import("../../../../src/cli/commands/recommend.js")["cmdRecommend"];

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@n-dx/claude-client", () => ({
      PROJECT_DIRS: {
        REX: ".rex",
        SOURCEVISION: ".sourcevision",
      },
      formatUsage: () => "",
      toCanonicalJSON: (value: unknown) => JSON.stringify(value, null, 2),
      result: () => {},
      info: () => {},
      setQuiet: () => {},
      isQuiet: () => false,
    }));
    ({ cmdRecommend } = await import("../../../../src/cli/commands/recommend.js"));

    tmpDir = await mkdtemp(join(tmpdir(), "rex-recommend-test-"));
    await writeFixtureProject(tmpDir);
  });

  afterEach(async () => {
    vi.doUnmock("@n-dx/claude-client");
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("accepts only specified recommendation indices", async () => {
    await cmdRecommend(tmpDir, { accept: "=2" });

    const items = await readPrdItems(tmpDir);
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("Address perf issues");
    expect(items[0].status).toBe("pending");
  });

  it("preserves recommendation list order for accepted subset", async () => {
    await cmdRecommend(tmpDir, { accept: "=3,1" });

    const items = await readPrdItems(tmpDir);
    expect(items).toHaveLength(2);
    expect(items[0].title).toContain("Address auth issues");
    expect(items[1].title).toContain("Address security issues");
  });

  it("parses equals-prefixed indices with commas and whitespace", async () => {
    await writeFindings(tmpDir, [
      { severity: "warning", category: "auth", message: "Auth finding" },
      { severity: "warning", category: "perf", message: "Perf finding" },
      { severity: "warning", category: "security", message: "Security finding" },
      { severity: "warning", category: "docs", message: "Docs finding" },
      { severity: "warning", category: "ops", message: "Ops finding" },
    ]);

    await cmdRecommend(tmpDir, { accept: "=1, 4, 5" });

    const items = await readPrdItems(tmpDir);
    expect(items).toHaveLength(3);
    expect(items[0].title).toContain("Address auth issues");
    expect(items[1].title).toContain("Address docs issues");
    expect(items[2].title).toContain("Address ops issues");
  });

  it("keeps all-accept behavior when no equals selector is provided", async () => {
    await cmdRecommend(tmpDir, { accept: "1,3" });

    const items = await readPrdItems(tmpDir);
    expect(items).toHaveLength(3);
  });
});
