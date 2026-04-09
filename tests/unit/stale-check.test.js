import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkProjectHealth,
  formatStaleSuggestion,
  EXPECTED_REX_SCHEMA,
  EXPECTED_SV_SCHEMA,
  EXPECTED_HENCH_SCHEMA,
} from "../../packages/core/stale-check.js";

// ── Module-level mocks ────────────────────────────────────────────────────────
// vi.mock() is hoisted by Vitest, so fs mock is active before the module loads.

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const fsMod = await import("node:fs");
const { existsSync, readFileSync } = fsMod;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal healthy project fixture so tests only need to override
 * the files relevant to the scenario under test.
 */
function buildHealthyFiles(overrides = {}) {
  const defaults = {
    ".sourcevision/manifest.json": JSON.stringify({
      schemaVersion: EXPECTED_SV_SCHEMA,
      toolVersion: "0.1.0",
      analyzedAt: "2026-01-01T00:00:00.000Z",
      targetPath: "/project",
      modules: {},
    }),
    ".rex/prd.json": JSON.stringify({
      schema: EXPECTED_REX_SCHEMA,
      title: "test",
      items: [],
    }),
    ".rex/config.json": JSON.stringify({
      schema: EXPECTED_REX_SCHEMA,
      project: "test",
      adapter: "file",
      sourcevision: "auto",
    }),
    ".hench/config.json": JSON.stringify({
      schema: EXPECTED_HENCH_SCHEMA,
      provider: "cli",
      model: "sonnet",
      maxTurns: 50,
      rexDir: ".rex",
    }),
    ".n-dx.json": JSON.stringify({
      llm: { vendor: "claude" },
      initVersion: "0.2.0",
    }),
  };
  return { ...defaults, ...overrides };
}

/**
 * Wire existsSync and readFileSync stubs for a given set of file fixtures.
 * Files in `files` map "<relative-path>" → file content string.
 * Files not in the map are treated as missing (existsSync → false).
 */
function setupFiles(files) {
  existsSync.mockImplementation((p) => {
    // Check directory existence: a path like "/dir/.rex" exists if any key starts with ".rex"
    const rel = p.replace(/^.*?(?=\.\w)/, "");
    // Match both directory-only paths (e.g. ".rex") and file paths (e.g. ".rex/prd.json")
    return Object.keys(files).some(
      (k) => k === rel || k.startsWith(rel + "/") || rel.endsWith(k),
    );
  });

  readFileSync.mockImplementation((p, _enc) => {
    for (const [key, content] of Object.entries(files)) {
      if (p.endsWith(key)) return content;
    }
    throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
  });
}

// ── checkProjectHealth ────────────────────────────────────────────────────────

describe("checkProjectHealth", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns no issues for a healthy up-to-date project", () => {
    setupFiles(buildHealthyFiles());
    const { issues, initVersion } = checkProjectHealth("/project");
    expect(issues).toHaveLength(0);
    expect(initVersion).toBe("0.2.0");
  });

  // ── Missing directories ────────────────────────────────────────────────────

  it("reports missing_dirs when .rex is absent", () => {
    const files = buildHealthyFiles();
    delete files[".rex/prd.json"];
    delete files[".rex/config.json"];
    setupFiles(files);

    const { issues } = checkProjectHealth("/project");
    const dirIssue = issues.find((i) => i.type === "missing_dirs");
    expect(dirIssue).toBeDefined();
    expect(dirIssue.dirs).toContain(".rex");
  });

  it("reports missing_dirs when all three dirs are absent", () => {
    setupFiles({
      ".n-dx.json": JSON.stringify({ llm: { vendor: "claude" } }),
    });

    const { issues } = checkProjectHealth("/project");
    const dirIssue = issues.find((i) => i.type === "missing_dirs");
    expect(dirIssue).toBeDefined();
    expect(dirIssue.dirs).toEqual(
      expect.arrayContaining([".sourcevision", ".rex", ".hench"]),
    );
  });

  it("returns no missing_dirs issue when all three dirs are present", () => {
    setupFiles(buildHealthyFiles());
    const { issues } = checkProjectHealth("/project");
    expect(issues.find((i) => i.type === "missing_dirs")).toBeUndefined();
  });

  // ── Rex schema mismatch ────────────────────────────────────────────────────

  it("reports schema_mismatch for an old rex prd.json schema", () => {
    setupFiles(
      buildHealthyFiles({
        ".rex/prd.json": JSON.stringify({ schema: "rex/v0", title: "t", items: [] }),
      }),
    );

    const { issues } = checkProjectHealth("/project");
    const mismatch = issues.find(
      (i) => i.type === "schema_mismatch" && i.file === ".rex/prd.json",
    );
    expect(mismatch).toBeDefined();
    expect(mismatch.found).toBe("rex/v0");
    expect(mismatch.expected).toBe(EXPECTED_REX_SCHEMA);
  });

  it("accepts a forward-compatible rex minor version (rex/v1.1)", () => {
    setupFiles(
      buildHealthyFiles({
        ".rex/prd.json": JSON.stringify({ schema: "rex/v1.1", title: "t", items: [] }),
      }),
    );

    const { issues } = checkProjectHealth("/project");
    expect(
      issues.find((i) => i.type === "schema_mismatch" && i.file === ".rex/prd.json"),
    ).toBeUndefined();
  });

  it("does not report schema mismatch when rex/prd.json has no schema field", () => {
    setupFiles(
      buildHealthyFiles({
        ".rex/prd.json": JSON.stringify({ title: "t", items: [] }),
      }),
    );

    const { issues } = checkProjectHealth("/project");
    expect(
      issues.find((i) => i.type === "schema_mismatch" && i.file === ".rex/prd.json"),
    ).toBeUndefined();
  });

  // ── SourceVision schema mismatch ──────────────────────────────────────────

  it("reports schema_mismatch for an old sourcevision manifest", () => {
    setupFiles(
      buildHealthyFiles({
        ".sourcevision/manifest.json": JSON.stringify({
          schemaVersion: "0.9.0",
          modules: {},
        }),
      }),
    );

    const { issues } = checkProjectHealth("/project");
    const mismatch = issues.find(
      (i) => i.type === "schema_mismatch" && i.file === ".sourcevision/manifest.json",
    );
    expect(mismatch).toBeDefined();
    expect(mismatch.found).toBe("0.9.0");
    expect(mismatch.expected).toBe(EXPECTED_SV_SCHEMA);
  });

  it("does not report schema mismatch when manifest has no schemaVersion field", () => {
    setupFiles(
      buildHealthyFiles({
        ".sourcevision/manifest.json": JSON.stringify({ modules: {} }),
      }),
    );

    const { issues } = checkProjectHealth("/project");
    expect(
      issues.find(
        (i) => i.type === "schema_mismatch" && i.file === ".sourcevision/manifest.json",
      ),
    ).toBeUndefined();
  });

  // ── Hench schema mismatch ──────────────────────────────────────────────────

  it("reports schema_mismatch for an old hench config.json schema", () => {
    setupFiles(
      buildHealthyFiles({
        ".hench/config.json": JSON.stringify({ schema: "hench/v0", model: "sonnet" }),
      }),
    );

    const { issues } = checkProjectHealth("/project");
    const mismatch = issues.find(
      (i) => i.type === "schema_mismatch" && i.file === ".hench/config.json",
    );
    expect(mismatch).toBeDefined();
    expect(mismatch.found).toBe("hench/v0");
    expect(mismatch.expected).toBe(EXPECTED_HENCH_SCHEMA);
  });

  // ── Missing config keys ───────────────────────────────────────────────────

  it("reports missing_config_keys when .n-dx.json lacks llm", () => {
    setupFiles(
      buildHealthyFiles({
        ".n-dx.json": JSON.stringify({ web: { port: 3117 } }),
      }),
    );

    const { issues } = checkProjectHealth("/project");
    const keyIssue = issues.find(
      (i) => i.type === "missing_config_keys" && i.file === ".n-dx.json",
    );
    expect(keyIssue).toBeDefined();
    expect(keyIssue.keys).toContain("llm");
  });

  it("reports missing_config_keys when .rex/config.json lacks required keys", () => {
    setupFiles(
      buildHealthyFiles({
        ".rex/config.json": JSON.stringify({ schema: EXPECTED_REX_SCHEMA }),
        // missing 'project' and 'adapter'
      }),
    );

    const { issues } = checkProjectHealth("/project");
    const keyIssue = issues.find(
      (i) => i.type === "missing_config_keys" && i.file === ".rex/config.json",
    );
    expect(keyIssue).toBeDefined();
    expect(keyIssue.keys).toEqual(expect.arrayContaining(["project", "adapter"]));
  });

  it("does not report missing_config_keys when .n-dx.json is absent", () => {
    const files = buildHealthyFiles();
    delete files[".n-dx.json"];
    setupFiles(files);

    const { issues } = checkProjectHealth("/project");
    expect(
      issues.find((i) => i.type === "missing_config_keys" && i.file === ".n-dx.json"),
    ).toBeUndefined();
  });

  // ── initVersion ───────────────────────────────────────────────────────────

  it("returns initVersion from .n-dx.json", () => {
    setupFiles(buildHealthyFiles({ ".n-dx.json": JSON.stringify({ llm: {}, initVersion: "0.1.5" }) }));
    const { initVersion } = checkProjectHealth("/project");
    expect(initVersion).toBe("0.1.5");
  });

  it("returns null initVersion when .n-dx.json has no initVersion field", () => {
    setupFiles(buildHealthyFiles({ ".n-dx.json": JSON.stringify({ llm: { vendor: "claude" } }) }));
    const { initVersion } = checkProjectHealth("/project");
    expect(initVersion).toBeNull();
  });

  it("returns null initVersion when .n-dx.json is absent", () => {
    const files = buildHealthyFiles();
    delete files[".n-dx.json"];
    setupFiles(files);
    const { initVersion } = checkProjectHealth("/project");
    expect(initVersion).toBeNull();
  });

  // ── Resilience ─────────────────────────────────────────────────────────────

  it("never throws when a JSON file is malformed", () => {
    setupFiles(
      buildHealthyFiles({ ".rex/prd.json": "{ not valid json {{" }),
    );
    expect(() => checkProjectHealth("/project")).not.toThrow();
  });

  it("never throws when readFileSync throws an unexpected error", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockImplementation(() => {
      throw new Error("catastrophic failure");
    });
    expect(() => checkProjectHealth("/project")).not.toThrow();
  });

  it("returns empty issues for a brand-new project with no files", () => {
    existsSync.mockReturnValue(false);
    const { issues, initVersion } = checkProjectHealth("/project");
    // Only missing_dirs issue — all three dirs absent
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("missing_dirs");
    expect(initVersion).toBeNull();
  });
});

// ── formatStaleSuggestion ─────────────────────────────────────────────────────

describe("formatStaleSuggestion", () => {
  it("returns null when there are no issues", () => {
    expect(formatStaleSuggestion([], "0.2.0")).toBeNull();
    expect(formatStaleSuggestion([], null)).toBeNull();
  });

  it("includes the init version in the header when provided", () => {
    const msg = formatStaleSuggestion(
      [{ type: "missing_dirs", dirs: [".rex"] }],
      "0.1.5",
    );
    expect(msg).toContain("0.1.5");
    expect(msg).toContain("ndx init");
  });

  it("uses a generic header when initVersion is null", () => {
    const msg = formatStaleSuggestion(
      [{ type: "missing_dirs", dirs: [".rex"] }],
      null,
    );
    expect(msg).not.toContain("null");
    expect(msg).toContain("ndx init");
  });

  it("formats missing_dirs details", () => {
    const msg = formatStaleSuggestion(
      [{ type: "missing_dirs", dirs: [".rex", ".hench"] }],
      null,
    );
    expect(msg).toContain(".rex");
    expect(msg).toContain(".hench");
  });

  it("formats schema_mismatch details", () => {
    const msg = formatStaleSuggestion(
      [
        {
          type: "schema_mismatch",
          file: ".rex/prd.json",
          found: "rex/v0",
          expected: "rex/v1",
        },
      ],
      "0.1.0",
    );
    expect(msg).toContain(".rex/prd.json");
    expect(msg).toContain("rex/v0");
    expect(msg).toContain("rex/v1");
  });

  it("formats missing_config_keys details", () => {
    const msg = formatStaleSuggestion(
      [
        {
          type: "missing_config_keys",
          file: ".n-dx.json",
          keys: ["llm"],
        },
      ],
      null,
    );
    expect(msg).toContain(".n-dx.json");
    expect(msg).toContain("llm");
  });

  it("combines multiple issues into a single message", () => {
    const msg = formatStaleSuggestion(
      [
        { type: "missing_dirs", dirs: [".rex"] },
        { type: "schema_mismatch", file: ".hench/config.json", found: "hench/v0", expected: "hench/v1" },
        { type: "missing_config_keys", file: ".n-dx.json", keys: ["llm"] },
      ],
      "0.1.0",
    );
    expect(msg).toContain(".rex");
    expect(msg).toContain(".hench/config.json");
    expect(msg).toContain(".n-dx.json");
  });

  it("starts with a warning symbol character", () => {
    const msg = formatStaleSuggestion(
      [{ type: "missing_dirs", dirs: [".rex"] }],
      null,
    );
    // ⚠ U+26A0 warning sign
    expect(msg).toMatch(/^\u26a0/);
  });
});

// ── EXPECTED_* constants ──────────────────────────────────────────────────────

describe("schema version constants", () => {
  it("EXPECTED_REX_SCHEMA matches the rex/v1 identifier", () => {
    expect(EXPECTED_REX_SCHEMA).toBe("rex/v1");
  });

  it("EXPECTED_SV_SCHEMA matches the sourcevision 1.0.0 version", () => {
    expect(EXPECTED_SV_SCHEMA).toBe("1.0.0");
  });

  it("EXPECTED_HENCH_SCHEMA matches the hench/v1 identifier", () => {
    expect(EXPECTED_HENCH_SCHEMA).toBe("hench/v1");
  });
});
