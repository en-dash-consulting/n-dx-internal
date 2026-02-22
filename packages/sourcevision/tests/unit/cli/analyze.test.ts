import { describe, it, expect, afterEach } from "vitest";
import { setLLMConfig, DEFAULT_CODEX_MODEL, DEFAULT_MODEL } from "../../../src/analyzers/claude-client.js";
import { resolveAnalyzeTokenEventMetadata } from "../../../src/cli/commands/analyze.js";

describe("analyze token usage metadata", () => {
  afterEach(() => {
    setLLMConfig({});
  });

  it("uses configured codex model when present", () => {
    const llmConfig = {
      vendor: "codex",
      codex: { model: "gpt-5-codex-custom" },
    } as const;
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata).toEqual({
      vendor: "codex",
      model: "gpt-5-codex-custom",
    });
  });

  it("falls back to default codex model when codex model is not configured", () => {
    const llmConfig = { vendor: "codex", codex: {} } as const;
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata).toEqual({
      vendor: "codex",
      model: DEFAULT_CODEX_MODEL,
    });
  });

  it("falls back to default claude model when claude model is not configured", () => {
    const llmConfig = { vendor: "claude", claude: {} } as const;
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata).toEqual({
      vendor: "claude",
      model: DEFAULT_MODEL,
    });
  });
});
