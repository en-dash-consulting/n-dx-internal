import { describe, it, expect } from "vitest";
import { resolveInitLLMSelection } from "../../packages/core/init-llm.js";

describe("resolveInitLLMSelection", () => {
  // ── Flag precedence ──────────────────────────────────────────────────────

  describe("flags take precedence over existing config", () => {
    it("uses provider from flag even when config has a different vendor", () => {
      const result = resolveInitLLMSelection({
        flags: { provider: "codex" },
        existingConfig: { vendor: "claude", model: "claude-sonnet-4-6" },
        isTTY: true,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("flag");
    });

    it("uses model from flag even when config has a different model", () => {
      const result = resolveInitLLMSelection({
        flags: { provider: "claude", model: "claude-opus-4-20250514" },
        existingConfig: { vendor: "claude", model: "claude-sonnet-4-6" },
        isTTY: true,
      });
      expect(result.model).toBe("claude-opus-4-20250514");
      expect(result.modelSource).toBe("flag");
    });

    it("uses both provider and model from flags when both are given", () => {
      const result = resolveInitLLMSelection({
        flags: { provider: "codex", model: "gpt-5-codex" },
        existingConfig: {},
        isTTY: true,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("flag");
      expect(result.model).toBe("gpt-5-codex");
      expect(result.modelSource).toBe("flag");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });
  });

  // ── Existing config skips prompting ──────────────────────────────────────

  describe("existing config skips prompting when both vendor and model are set", () => {
    it("uses existing vendor and model without prompting", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "claude", model: "claude-sonnet-4-6" },
        isTTY: true,
      });
      expect(result.provider).toBe("claude");
      expect(result.providerSource).toBe("config");
      expect(result.model).toBe("claude-sonnet-4-6");
      expect(result.modelSource).toBe("config");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });

    it("uses existing codex vendor and model without prompting", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "codex", model: "gpt-5-codex" },
        isTTY: true,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("config");
      expect(result.model).toBe("gpt-5-codex");
      expect(result.modelSource).toBe("config");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });
  });

  // ── Missing model triggers model-only prompt ─────────────────────────────

  describe("missing model triggers model-only prompt when vendor is already set", () => {
    it("needs model prompt when vendor exists but model is absent", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "claude" },
        isTTY: true,
      });
      expect(result.provider).toBe("claude");
      expect(result.providerSource).toBe("config");
      expect(result.model).toBeUndefined();
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(true);
    });

    it("needs model prompt when vendor exists but model is undefined", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "codex", model: undefined },
        isTTY: true,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("config");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(true);
    });

    it("does not need model prompt when flag provides model for existing vendor", () => {
      const result = resolveInitLLMSelection({
        flags: { model: "claude-opus-4-20250514" },
        existingConfig: { vendor: "claude" },
        isTTY: true,
      });
      expect(result.provider).toBe("claude");
      expect(result.providerSource).toBe("config");
      expect(result.model).toBe("claude-opus-4-20250514");
      expect(result.modelSource).toBe("flag");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });
  });

  // ── Non-TTY environments ─────────────────────────────────────────────────

  describe("non-TTY environments skip prompts and use defaults/flags", () => {
    it("skips all prompts in non-TTY even when nothing is configured", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: {},
        isTTY: false,
      });
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });

    it("uses flags in non-TTY when provided", () => {
      const result = resolveInitLLMSelection({
        flags: { provider: "codex", model: "gpt-5-codex" },
        existingConfig: {},
        isTTY: false,
      });
      expect(result.provider).toBe("codex");
      expect(result.model).toBe("gpt-5-codex");
      expect(result.providerSource).toBe("flag");
      expect(result.modelSource).toBe("flag");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });

    it("uses existing config in non-TTY", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "claude", model: "claude-sonnet-4-6" },
        isTTY: false,
      });
      expect(result.provider).toBe("claude");
      expect(result.model).toBe("claude-sonnet-4-6");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });

    it("skips model prompt in non-TTY even when vendor exists but model is absent", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "codex" },
        isTTY: false,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("config");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });
  });

  // ── Fresh init (no config, no flags) ─────────────────────────────────────

  describe("fresh init with no config and no flags", () => {
    it("needs both prompts in TTY mode", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: {},
        isTTY: true,
      });
      expect(result.provider).toBeUndefined();
      expect(result.model).toBeUndefined();
      expect(result.needsProviderPrompt).toBe(true);
      expect(result.needsModelPrompt).toBe(true);
    });
  });

  // ── Provider flag without model ──────────────────────────────────────────

  describe("provider flag without model", () => {
    it("needs model prompt in TTY when only provider flag is given", () => {
      const result = resolveInitLLMSelection({
        flags: { provider: "claude" },
        existingConfig: {},
        isTTY: true,
      });
      expect(result.provider).toBe("claude");
      expect(result.providerSource).toBe("flag");
      expect(result.model).toBeUndefined();
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(true);
    });

    it("skips model prompt in non-TTY when only provider flag is given", () => {
      const result = resolveInitLLMSelection({
        flags: { provider: "codex" },
        existingConfig: {},
        isTTY: false,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("flag");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty string model in config as missing", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "claude", model: "" },
        isTTY: true,
      });
      expect(result.needsModelPrompt).toBe(true);
    });

    it("flag model overrides config model even when provider comes from config", () => {
      const result = resolveInitLLMSelection({
        flags: { model: "claude-haiku-4-20250414" },
        existingConfig: { vendor: "claude", model: "claude-sonnet-4-6" },
        isTTY: true,
      });
      expect(result.provider).toBe("claude");
      expect(result.providerSource).toBe("config");
      expect(result.model).toBe("claude-haiku-4-20250414");
      expect(result.modelSource).toBe("flag");
    });

    it("flag provider with config model from different vendor needs model prompt", () => {
      // Switching vendors means the old model is irrelevant
      const result = resolveInitLLMSelection({
        flags: { provider: "codex" },
        existingConfig: { vendor: "claude", model: "claude-sonnet-4-6" },
        isTTY: true,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("flag");
      // Model from config is for claude, not codex — should not carry over
      expect(result.model).toBeUndefined();
      expect(result.needsModelPrompt).toBe(true);
    });
  });
});
