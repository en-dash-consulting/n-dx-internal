/**
 * Unit tests for prompts.verbosity config — schema, defaults, validation, and
 * prompt-renderer initialization.
 *
 * Acceptance criteria coverage:
 * - schema default ('compact')
 * - set: initPromptRenderer stores the supplied verbosity
 * - get: getPromptVerbosity returns the current value
 * - validation-rejection: Zod schema rejects out-of-enum values with a message
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  validateConfig,
  formatValidationErrors,
} from "../../../src/schema/validate.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import {
  initPromptRenderer,
  resetPromptRenderer,
  getPromptVerbosity,
  buildSystemPrompt,
} from "../../../src/agent/planning/prompt.js";
import type { TaskBriefProject } from "../../../src/schema/v1.js";

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("prompts config schema", () => {
  it("default config has no prompts section (field is optional)", () => {
    const config = DEFAULT_HENCH_CONFIG();
    expect(config.prompts).toBeUndefined();
  });

  it("validateConfig accepts config without prompts (default behaviour)", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.prompts).toBeUndefined();
    }
  });

  it("validateConfig accepts prompts.verbosity = 'compact'", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), prompts: { verbosity: "compact" as const } };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.prompts?.verbosity).toBe("compact");
    }
  });

  it("validateConfig accepts prompts.verbosity = 'verbose'", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), prompts: { verbosity: "verbose" as const } };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.prompts?.verbosity).toBe("verbose");
    }
  });

  it("validateConfig rejects prompts.verbosity outside the enum", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), prompts: { verbosity: "loud" } };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });

  it("validation error for invalid verbosity includes path and descriptive message", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), prompts: { verbosity: "maximum" } };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = formatValidationErrors(result.errors);
      expect(messages.length).toBeGreaterThan(0);
      // Should mention the field path
      const combined = messages.join(" ");
      expect(combined).toMatch(/prompts|verbosity/i);
    }
  });

  it("verbosity defaults to 'compact' when prompts section has empty object", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), prompts: {} };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Zod applies the .default("compact") when verbosity is omitted
      expect(result.data.prompts?.verbosity).toBe("compact");
    }
  });
});

// ---------------------------------------------------------------------------
// Prompt renderer initialization (set / get)
// ---------------------------------------------------------------------------

describe("prompt renderer verbosity state", () => {
  afterEach(() => {
    resetPromptRenderer();
  });

  it("getPromptVerbosity returns 'compact' as the default", () => {
    expect(getPromptVerbosity()).toBe("compact");
  });

  it("initPromptRenderer sets verbosity to 'verbose'", () => {
    initPromptRenderer("verbose");
    expect(getPromptVerbosity()).toBe("verbose");
  });

  it("initPromptRenderer sets verbosity to 'compact'", () => {
    initPromptRenderer("verbose"); // change it first
    initPromptRenderer("compact");
    expect(getPromptVerbosity()).toBe("compact");
  });

  it("resetPromptRenderer restores default 'compact'", () => {
    initPromptRenderer("verbose");
    resetPromptRenderer();
    expect(getPromptVerbosity()).toBe("compact");
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt respects verbosity
// ---------------------------------------------------------------------------

const testProject: TaskBriefProject = {
  name: "test-project",
  validateCommand: "pnpm typecheck",
  testCommand: "pnpm test",
};

describe("buildSystemPrompt verbosity integration", () => {
  afterEach(() => {
    resetPromptRenderer();
  });

  it("compact mode (default) does NOT emit Extended Context section", () => {
    initPromptRenderer("compact");
    const config = DEFAULT_HENCH_CONFIG();
    const prompt = buildSystemPrompt(testProject, config);
    expect(prompt).not.toContain("## Extended Context");
  });

  it("verbose mode emits Extended Context section", () => {
    initPromptRenderer("verbose");
    const config = DEFAULT_HENCH_CONFIG();
    const prompt = buildSystemPrompt(testProject, config);
    expect(prompt).toContain("## Extended Context");
  });

  it("verbose mode includes additional rationale for rules", () => {
    initPromptRenderer("verbose");
    const config = DEFAULT_HENCH_CONFIG();
    const prompt = buildSystemPrompt(testProject, config);
    expect(prompt).toContain("minimal changes matter");
  });

  it("verbose mode includes test-first rationale", () => {
    initPromptRenderer("verbose");
    const config = DEFAULT_HENCH_CONFIG();
    const prompt = buildSystemPrompt(testProject, config);
    expect(prompt).toContain("tests come first");
  });

  it("verbosity setting is independent of provider", () => {
    initPromptRenderer("verbose");
    const apiConfig = { ...DEFAULT_HENCH_CONFIG(), provider: "api" as const };
    const cliConfig = { ...DEFAULT_HENCH_CONFIG(), provider: "cli" as const };
    const apiPrompt = buildSystemPrompt(testProject, apiConfig);
    const cliPrompt = buildSystemPrompt(testProject, cliConfig);
    expect(apiPrompt).toContain("## Extended Context");
    expect(cliPrompt).toContain("## Extended Context");
  });
});
