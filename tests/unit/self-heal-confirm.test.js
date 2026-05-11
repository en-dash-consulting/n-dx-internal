import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseRecommendationsJson,
  formatQueuedTaskSummary,
  readSelfHealAutoConfirm,
  resolveAutoConfirm,
  runConfirmationPrompt,
} from "../../packages/core/self-heal-confirm.js";

describe("parseRecommendationsJson", () => {
  it("returns empty summary for blank input", () => {
    expect(parseRecommendationsJson("")).toEqual({ tasks: [], totalFindings: 0 });
    expect(parseRecommendationsJson("   \n")).toEqual({ tasks: [], totalFindings: 0 });
  });

  it("returns empty summary for invalid JSON", () => {
    expect(parseRecommendationsJson("not json")).toEqual({ tasks: [], totalFindings: 0 });
  });

  it("returns empty summary when payload is not an array", () => {
    expect(parseRecommendationsJson(JSON.stringify({ foo: 1 }))).toEqual({
      tasks: [],
      totalFindings: 0,
    });
  });

  it("collects only level=task entries with finding counts", () => {
    const payload = [
      { level: "epic", title: "Skip epic" },
      { level: "feature", title: "Skip feature" },
      { level: "task", title: "Task A", meta: { findingCount: 3 } },
      { level: "task", title: "Task B", meta: { findingCount: 1 } },
      { level: "task", title: "Task C" }, // no meta — count defaults to 0
    ];
    const summary = parseRecommendationsJson(JSON.stringify(payload));
    expect(summary.tasks).toEqual([
      { title: "Task A", findingCount: 3 },
      { title: "Task B", findingCount: 1 },
      { title: "Task C", findingCount: 0 },
    ]);
    expect(summary.totalFindings).toBe(4);
  });

  it("substitutes a placeholder for missing titles", () => {
    const summary = parseRecommendationsJson(
      JSON.stringify([{ level: "task", meta: { findingCount: 1 } }]),
    );
    expect(summary.tasks).toEqual([{ title: "(untitled task)", findingCount: 1 }]);
  });
});

describe("formatQueuedTaskSummary", () => {
  it("describes a single-iteration run with one task", () => {
    const text = formatQueuedTaskSummary({
      summary: { tasks: [{ title: "Fix thing", findingCount: 2 }], totalFindings: 2 },
      currentIteration: 1,
      totalIterations: 1,
    });
    expect(text).toContain("Queued for iteration 1/1: 1 task (covering 2 findings)");
    expect(text).toContain("1. Fix thing  [2 findings]");
    expect(text).not.toContain("Self-heal will run up to");
  });

  it("notes multi-iteration plans", () => {
    const text = formatQueuedTaskSummary({
      summary: { tasks: [{ title: "Task A", findingCount: 1 }], totalFindings: 1 },
      currentIteration: 1,
      totalIterations: 3,
    });
    expect(text).toContain("Self-heal will run up to 3 iterations");
  });

  it("warns when nothing is queued", () => {
    const text = formatQueuedTaskSummary({
      summary: { tasks: [], totalFindings: 0 },
      currentIteration: 1,
      totalIterations: 1,
    });
    expect(text).toContain("Queued for iteration 1/1: 0 tasks");
    expect(text).toContain("nothing to execute");
  });

  it("truncates long task lists with a 'and N more' footer", () => {
    const tasks = Array.from({ length: 25 }, (_, i) => ({
      title: `Task ${i + 1}`,
      findingCount: 1,
    }));
    const text = formatQueuedTaskSummary({
      summary: { tasks, totalFindings: 25 },
      currentIteration: 1,
      totalIterations: 1,
    });
    expect(text).toContain("20. Task 20");
    expect(text).not.toContain("21. Task 21");
    expect(text).toContain("…and 5 more");
  });
});

describe("readSelfHealAutoConfirm", () => {
  it("returns false when .n-dx.json is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "selfheal-cfg-"));
    try {
      expect(readSelfHealAutoConfirm(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false for malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "selfheal-cfg-"));
    try {
      writeFileSync(join(dir, ".n-dx.json"), "{ not json");
      expect(readSelfHealAutoConfirm(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false when selfHeal.autoConfirm is absent or non-boolean-true", () => {
    const dir = mkdtempSync(join(tmpdir(), "selfheal-cfg-"));
    try {
      writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({}));
      expect(readSelfHealAutoConfirm(dir)).toBe(false);
      writeFileSync(
        join(dir, ".n-dx.json"),
        JSON.stringify({ selfHeal: { autoConfirm: "yes" } }),
      );
      expect(readSelfHealAutoConfirm(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns true when selfHeal.autoConfirm === true", () => {
    const dir = mkdtempSync(join(tmpdir(), "selfheal-cfg-"));
    try {
      writeFileSync(
        join(dir, ".n-dx.json"),
        JSON.stringify({ selfHeal: { autoConfirm: true } }),
      );
      expect(readSelfHealAutoConfirm(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveAutoConfirm", () => {
  it("returns flag source when --auto is passed", () => {
    expect(resolveAutoConfirm({ argv: ["--auto"], configAutoConfirm: false })).toEqual({
      autoConfirm: true,
      source: "flag",
    });
  });

  it("returns flag source when --yes is passed", () => {
    expect(resolveAutoConfirm({ argv: ["--yes"], configAutoConfirm: false })).toEqual({
      autoConfirm: true,
      source: "flag",
    });
  });

  it("flag wins over config=false", () => {
    expect(resolveAutoConfirm({ argv: ["--auto"], configAutoConfirm: false })).toEqual({
      autoConfirm: true,
      source: "flag",
    });
  });

  it("config-only sets autoConfirm with config source", () => {
    expect(resolveAutoConfirm({ argv: [], configAutoConfirm: true })).toEqual({
      autoConfirm: true,
      source: "config",
    });
  });

  it("neither flag nor config leaves autoConfirm false", () => {
    expect(resolveAutoConfirm({ argv: ["3", "."], configAutoConfirm: false })).toEqual({
      autoConfirm: false,
      source: "none",
    });
  });
});

// ── runConfirmationPrompt ─────────────────────────────────────────────────────
//
// Use captured streams + a stub readline factory so the prompt is fully
// driven from the test, with no real TTY required.

function captureStream() {
  const chunks = [];
  return {
    write: (chunk) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf-8"));
      return true;
    },
    output: () => chunks.join(""),
  };
}

function stubReadline(answer) {
  return () => ({
    question: async () => answer,
    close: () => {},
  });
}

describe("runConfirmationPrompt", () => {
  it("returns 'auto' and prints the summary without reading stdin when autoConfirm", async () => {
    const stdout = captureStream();
    const result = await runConfirmationPrompt({
      summaryText: "QUEUED",
      autoConfirm: true,
      isTTY: false,
      streams: { stdout, stderr: captureStream() },
      readlineFactory: () => {
        throw new Error("readline must not be created when autoConfirm=true");
      },
    });
    expect(result.decision).toBe("auto");
    expect(stdout.output()).toContain("QUEUED");
    expect(stdout.output()).toContain("Auto-confirm enabled");
  });

  it("returns 'no-tty' with an explanatory error when not a TTY and not auto-confirmed", async () => {
    const stderr = captureStream();
    const result = await runConfirmationPrompt({
      summaryText: "QUEUED",
      autoConfirm: false,
      isTTY: false,
      streams: { stdout: captureStream(), stderr },
      readlineFactory: () => {
        throw new Error("readline must not be created in non-TTY mode");
      },
    });
    expect(result.decision).toBe("no-tty");
    expect(result.message).toContain("--auto");
    expect(result.message).toContain("selfHeal.autoConfirm");
    expect(stderr.output()).toBe(result.message);
  });

  it("returns 'accept' when the user answers 'y'", async () => {
    const stdout = captureStream();
    const result = await runConfirmationPrompt({
      summaryText: "QUEUED",
      autoConfirm: false,
      isTTY: true,
      streams: { stdout, stderr: captureStream() },
      readlineFactory: stubReadline("y"),
    });
    expect(result.decision).toBe("accept");
    expect(stdout.output()).toContain("QUEUED");
  });

  it("accepts 'YES' (case-insensitive)", async () => {
    const result = await runConfirmationPrompt({
      summaryText: "QUEUED",
      autoConfirm: false,
      isTTY: true,
      streams: { stdout: captureStream(), stderr: captureStream() },
      readlineFactory: stubReadline("YES"),
    });
    expect(result.decision).toBe("accept");
  });

  it("declines on empty answer (default N)", async () => {
    const result = await runConfirmationPrompt({
      summaryText: "QUEUED",
      autoConfirm: false,
      isTTY: true,
      streams: { stdout: captureStream(), stderr: captureStream() },
      readlineFactory: stubReadline(""),
    });
    expect(result.decision).toBe("decline");
  });

  it("declines on 'n' / arbitrary input", async () => {
    for (const answer of ["n", "no", "nah", "maybe", " q "]) {
      const result = await runConfirmationPrompt({
        summaryText: "QUEUED",
        autoConfirm: false,
        isTTY: true,
        streams: { stdout: captureStream(), stderr: captureStream() },
        readlineFactory: stubReadline(answer),
      });
      expect(result.decision, `answer=${answer}`).toBe("decline");
    }
  });

  it("declines if readline rejects (e.g. SIGINT during prompt)", async () => {
    const result = await runConfirmationPrompt({
      summaryText: "QUEUED",
      autoConfirm: false,
      isTTY: true,
      streams: { stdout: captureStream(), stderr: captureStream() },
      readlineFactory: () => ({
        question: async () => {
          throw new Error("aborted");
        },
        close: () => {},
      }),
    });
    expect(result.decision).toBe("decline");
  });
});
