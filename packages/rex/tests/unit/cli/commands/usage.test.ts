import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdUsage } from "../../../../src/cli/commands/usage.js";
import type { PRDDocument } from "../../../../src/schema/index.js";

function writePRD(dir: string, doc: PRDDocument): void {
  writeFileSync(join(dir, ".rex", "prd.json"), JSON.stringify(doc));
}

function writeLog(dir: string, entries: Array<Record<string, unknown>>): void {
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(join(dir, ".rex", "execution-log.jsonl"), lines);
}

function writeHenchRun(
  dir: string,
  id: string,
  run: Record<string, unknown>,
): void {
  const runsDir = join(dir, ".hench", "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, `${id}.json`), JSON.stringify(run));
}

function writeSvManifest(
  dir: string,
  manifest: Record<string, unknown>,
): void {
  const svDir = join(dir, ".sourcevision");
  mkdirSync(svDir, { recursive: true });
  writeFileSync(join(svDir, "manifest.json"), JSON.stringify(manifest));
}

const MINIMAL_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Test Project",
  items: [],
};

let tmp: string;
let logSpy: ReturnType<typeof vi.spyOn>;

function output(): string {
  return logSpy.mock.calls.map((c) => c[0] ?? "").join("\n");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "rex-usage-test-"));
  mkdirSync(join(tmp, ".rex"));
  writePRD(tmp, MINIMAL_PRD);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  rmSync(tmp, { recursive: true, force: true });
});

describe("cmdUsage", () => {
  describe("tree output", () => {
    it("shows 'none recorded' when no token data exists", async () => {
      await cmdUsage(tmp, {});
      const out = output();
      expect(out).toContain("Token usage: none recorded");
    });

    it("shows total token counts with input/output breakdown", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 2,
            inputTokens: 3000,
            outputTokens: 500,
          }),
        },
      ]);

      await cmdUsage(tmp, {});
      const out = output();

      expect(out).toContain("3,500 tokens");
      expect(out).toContain("3,000 in");
      expect(out).toContain("500 out");
    });

    it("shows per-package breakdown", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 2,
            inputTokens: 3000,
            outputTokens: 500,
          }),
        },
      ]);
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        model: "sonnet",
        tokenUsage: { input: 5000, output: 1500 },
      });

      await cmdUsage(tmp, {});
      const out = output();

      expect(out).toContain("rex:");
      expect(out).toContain("hench:");
    });

    it("shows cost estimation", async () => {
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        model: "sonnet",
        tokenUsage: { input: 100000, output: 20000 },
      });

      await cmdUsage(tmp, {});
      const out = output();

      expect(out).toContain("Estimated cost:");
      expect(out).toContain("$");
    });

    it("does not show cost line when zero tokens", async () => {
      await cmdUsage(tmp, {});
      const out = output();

      expect(out).not.toContain("Estimated cost:");
    });

    it("applies --since filter", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-10T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 1,
            inputTokens: 1000,
            outputTokens: 200,
          }),
        },
        {
          timestamp: "2026-01-20T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 1,
            inputTokens: 5000,
            outputTokens: 800,
          }),
        },
      ]);

      await cmdUsage(tmp, { since: "2026-01-15T00:00:00.000Z" });
      const out = output();

      expect(out).toContain("5,800 tokens");
      expect(out).toContain("filtered:");
      expect(out).toContain("since");
    });

    it("applies --until filter", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-10T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 1,
            inputTokens: 1000,
            outputTokens: 200,
          }),
        },
        {
          timestamp: "2026-01-20T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 1,
            inputTokens: 5000,
            outputTokens: 800,
          }),
        },
      ]);

      await cmdUsage(tmp, { until: "2026-01-15T00:00:00.000Z" });
      const out = output();

      expect(out).toContain("1,200 tokens");
      expect(out).toContain("filtered:");
      expect(out).toContain("until");
    });

    it("shows per-package detail with input/output per package", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 2,
            inputTokens: 3000,
            outputTokens: 500,
          }),
        },
      ]);
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        model: "sonnet",
        tokenUsage: { input: 5000, output: 1500 },
      });
      writeSvManifest(tmp, {
        analyzedAt: "2026-01-17T10:00:00.000Z",
        tokenUsage: { calls: 1, inputTokens: 2000, outputTokens: 600 },
      });

      await cmdUsage(tmp, {});
      const out = output();

      // Should show per-package input/output detail
      expect(out).toContain("rex");
      expect(out).toContain("hench");
      expect(out).toContain("sv");
    });
  });

  describe("json output", () => {
    it("outputs valid JSON with all fields", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 2,
            inputTokens: 3000,
            outputTokens: 500,
          }),
        },
      ]);

      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.packages).toBeDefined();
      expect(parsed.packages.rex).toBeDefined();
      expect(parsed.packages.rex.inputTokens).toBe(3000);
      expect(parsed.packages.rex.outputTokens).toBe(500);
      expect(parsed.packages.rex.calls).toBe(2);
      expect(parsed.totalInputTokens).toBe(3000);
      expect(parsed.totalOutputTokens).toBe(500);
      expect(parsed.totalCalls).toBe(2);
    });

    it("includes cost estimation in JSON output", async () => {
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        model: "sonnet",
        tokenUsage: { input: 100000, output: 20000 },
      });

      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.estimatedCost).toBeDefined();
      expect(typeof parsed.estimatedCost.total).toBe("string");
      expect(parsed.estimatedCost.total).toMatch(/^\$/);
    });

    it("includes filter metadata in JSON output", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 1,
            inputTokens: 1000,
            outputTokens: 200,
          }),
        },
      ]);

      await cmdUsage(tmp, {
        format: "json",
        since: "2026-01-10T00:00:00.000Z",
        until: "2026-01-20T00:00:00.000Z",
      });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.filter).toBeDefined();
      expect(parsed.filter.since).toBe("2026-01-10T00:00:00.000Z");
      expect(parsed.filter.until).toBe("2026-01-20T00:00:00.000Z");
    });

    it("omits filter from JSON when no filters applied", async () => {
      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.filter).toBeUndefined();
    });
  });

  describe("cost estimation", () => {
    it("estimates cost using default Sonnet pricing", async () => {
      // Sonnet: $3/1M input, $15/1M output
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        model: "sonnet",
        tokenUsage: { input: 1000000, output: 1000000 },
      });

      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      // $3 input + $15 output = $18
      expect(parsed.estimatedCost.total).toBe("$18.00");
    });

    it("shows zero cost when no tokens", async () => {
      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.estimatedCost.total).toBe("$0.00");
    });
  });

  describe("error handling", () => {
    it("rejects invalid format", async () => {
      await expect(cmdUsage(tmp, { format: "csv" })).rejects.toThrow(
        /Unknown format/,
      );
    });
  });
});
