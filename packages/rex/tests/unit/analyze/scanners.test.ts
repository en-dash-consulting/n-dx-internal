import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanTests, scanDocs, scanSourceVision } from "../../../src/analyze/scanners.js";

describe("scanTests", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-scan-tests-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("extracts describe and it blocks from test files", async () => {
    await mkdir(join(tempDir, "tests"), { recursive: true });
    await writeFile(
      join(tempDir, "tests", "login.test.ts"),
      `
describe("Login Flow", () => {
  it("validates email format", () => {});
  it("handles invalid credentials", () => {});
});
`,
    );

    const results = await scanTests(tempDir);

    const features = results.filter((r) => r.kind === "feature");
    const tasks = results.filter((r) => r.kind === "task");

    expect(features.length).toBeGreaterThanOrEqual(1);
    expect(features.some((f) => f.name === "Login")).toBe(true);
    expect(features.some((f) => f.name === "Login Flow")).toBe(true);

    expect(tasks.length).toBe(2);
    expect(tasks.some((t) => t.name === "validates email format")).toBe(true);
    expect(tasks.some((t) => t.name === "handles invalid credentials")).toBe(true);
  });

  it("groups by directory to infer epic names", async () => {
    await mkdir(join(tempDir, "tests", "e2e", "auth"), { recursive: true });
    await writeFile(
      join(tempDir, "tests", "e2e", "auth", "login.test.ts"),
      `
describe("Login", () => {
  it("works", () => {});
});
`,
    );

    const results = await scanTests(tempDir);
    const feature = results.find((r) => r.kind === "feature");
    expect(feature?.tags).toContain("Auth");
  });

  it("lite mode uses filenames only, skips content", async () => {
    await mkdir(join(tempDir, "tests"), { recursive: true });
    await writeFile(
      join(tempDir, "tests", "auth.test.ts"),
      `
describe("Auth", () => {
  it("validates tokens", () => {});
  it("handles expiry", () => {});
});
`,
    );

    const results = await scanTests(tempDir, { lite: true });

    // Should only have file-level feature, no tasks from content
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("feature");
    expect(results[0].name).toBe("Auth");
    const tasks = results.filter((r) => r.kind === "task");
    expect(tasks.length).toBe(0);
  });

  it("handles spec files", async () => {
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(
      join(tempDir, "src", "utils.spec.js"),
      `
test("adds numbers", () => {});
`,
    );

    const results = await scanTests(tempDir);
    expect(results.some((r) => r.name === "adds numbers" && r.kind === "task")).toBe(true);
  });

  it("handles __tests__ directory", async () => {
    await mkdir(join(tempDir, "src", "__tests__"), { recursive: true });
    await writeFile(
      join(tempDir, "src", "__tests__", "helper.ts"),
      `
describe("Helper", () => {
  it("formats dates", () => {});
});
`,
    );

    const results = await scanTests(tempDir);
    expect(results.some((r) => r.name === "formats dates")).toBe(true);
  });

  it("returns empty for directory with no test files", async () => {
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src", "index.ts"), "export const x = 1;");

    const results = await scanTests(tempDir);
    expect(results).toEqual([]);
  });
});

describe("scanDocs", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-scan-docs-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("extracts markdown headings and bullets", async () => {
    await writeFile(
      join(tempDir, "features.md"),
      `# Auth System
- Login with email
- Password reset

# Dashboard
- Charts
`,
    );

    const results = await scanDocs(tempDir);

    const features = results.filter((r) => r.kind === "feature");
    expect(features.some((f) => f.name === "Auth System")).toBe(true);
    expect(features.some((f) => f.name === "Dashboard")).toBe(true);

    const authFeature = features.find((f) => f.name === "Auth System");
    expect(authFeature?.acceptanceCriteria).toEqual([
      "Login with email",
      "Password reset",
    ]);

    const tasks = results.filter((r) => r.kind === "task");
    expect(tasks.some((t) => t.name === "Login with email")).toBe(true);
    expect(tasks.some((t) => t.name === "Password reset")).toBe(true);
    expect(tasks.some((t) => t.name === "Charts")).toBe(true);
  });

  it("extracts items from JSON with title fields", async () => {
    await writeFile(
      join(tempDir, "features.json"),
      JSON.stringify([
        { title: "User Management", description: "CRUD for users" },
        { title: "Reporting", description: "Generate reports" },
      ]),
    );

    const results = await scanDocs(tempDir);
    expect(results.some((r) => r.name === "User Management")).toBe(true);
    expect(results.some((r) => r.name === "Reporting")).toBe(true);
    expect(results.find((r) => r.name === "User Management")?.description).toBe(
      "CRUD for users",
    );
  });

  it("extracts items from JSON with name fields", async () => {
    await writeFile(
      join(tempDir, "items.json"),
      JSON.stringify({ items: [{ name: "Feature A" }, { name: "Feature B" }] }),
    );

    const results = await scanDocs(tempDir);
    expect(results.some((r) => r.name === "Feature A")).toBe(true);
    expect(results.some((r) => r.name === "Feature B")).toBe(true);
  });

  it("extracts items from YAML", async () => {
    await writeFile(
      join(tempDir, "plan.yaml"),
      `
title: Authentication
description: Handle user auth

title: API Gateway
description: Route requests
`,
    );

    const results = await scanDocs(tempDir);
    expect(results.some((r) => r.name === "Authentication")).toBe(true);
    expect(results.some((r) => r.name === "API Gateway")).toBe(true);
  });

  it("skips node_modules and .git directories", async () => {
    await mkdir(join(tempDir, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      join(tempDir, "node_modules", "pkg", "README.md"),
      "# Package\n- stuff",
    );

    const results = await scanDocs(tempDir);
    expect(results).toEqual([]);
  });

  it("lite mode uses filenames only", async () => {
    await writeFile(
      join(tempDir, "auth-flow.md"),
      "# Auth\n- Login\n- Logout",
    );

    const results = await scanDocs(tempDir, { lite: true });
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Auth Flow");
    expect(results[0].kind).toBe("feature");
  });

  it("skips README and CHANGELOG in lite mode", async () => {
    await writeFile(join(tempDir, "README.md"), "# Project");
    await writeFile(join(tempDir, "CHANGELOG.md"), "# Changes");

    const results = await scanDocs(tempDir, { lite: true });
    expect(results).toEqual([]);
  });
});

describe("scanSourceVision", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-scan-sv-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads zone data and maps to features", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify([
        {
          name: "Authentication",
          description: "Auth module",
          insights: ["Uses JWT tokens", "Session management"],
          findings: [
            { severity: "critical", message: "Hardcoded secret" },
            { severity: "warning", message: "Missing rate limit" },
          ],
        },
      ]),
    );

    const results = await scanSourceVision(tempDir);

    const features = results.filter((r) => r.kind === "feature");
    expect(features.some((f) => f.name === "Authentication")).toBe(true);
    expect(features[0].acceptanceCriteria).toEqual([
      "Uses JWT tokens",
      "Session management",
    ]);

    const tasks = results.filter((r) => r.kind === "task");
    expect(tasks.some((t) => t.name === "Hardcoded secret")).toBe(true);
    expect(tasks.some((t) => t.name === "Missing rate limit")).toBe(true);

    const critical = tasks.find((t) => t.name === "Hardcoded secret");
    expect(critical?.priority).toBe("critical");
    const warning = tasks.find((t) => t.name === "Missing rate limit");
    expect(warning?.priority).toBe("high");
  });

  it("reads inventory.json for epic groupings", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "inventory.json"),
      JSON.stringify({
        byCategory: {
          components: { count: 10 },
          services: { count: 5 },
        },
      }),
    );

    const results = await scanSourceVision(tempDir);
    const epics = results.filter((r) => r.kind === "epic");
    expect(epics.some((e) => e.name === "Components")).toBe(true);
    expect(epics.some((e) => e.name === "Services")).toBe(true);
  });

  it("reads imports.json for circular dependencies", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "imports.json"),
      JSON.stringify({
        circularDependencies: [
          { from: "moduleA", to: "moduleB" },
        ],
      }),
    );

    const results = await scanSourceVision(tempDir);
    const circulars = results.filter((r) => r.name.startsWith("Resolve circular"));
    expect(circulars.length).toBe(1);
    expect(circulars[0].name).toContain("moduleA");
    expect(circulars[0].name).toContain("moduleB");
    expect(circulars[0].priority).toBe("high");
  });

  it("handles circular array format in imports.json", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "imports.json"),
      JSON.stringify({
        circular: [["A", "B", "A"]],
      }),
    );

    const results = await scanSourceVision(tempDir);
    const circulars = results.filter((r) => r.name.startsWith("Resolve circular"));
    expect(circulars.length).toBe(1);
    expect(circulars[0].name).toContain("A");
  });

  it("returns empty when no .sourcevision directory", async () => {
    const results = await scanSourceVision(tempDir);
    expect(results).toEqual([]);
  });

  it("returns partial results when some files are missing", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    // Only zones.json, no inventory or imports
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify([{ name: "Core", description: "Core module" }]),
    );

    const results = await scanSourceVision(tempDir);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.name === "Core")).toBe(true);
  });
});
