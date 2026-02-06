import { join } from "node:path";
import { readFile, access } from "node:fs/promises";

const PROJECT_CONFIG_FILE = ".n-dx.json";

/**
 * Claude configuration from the unified .n-dx.json config.
 * These settings apply across all packages.
 */
export interface ClaudeConfig {
  /** Path to Claude Code CLI binary. When set, used instead of looking for "claude" on PATH. */
  cli_path?: string;
  /** Anthropic API key. When set, used instead of reading from the ANTHROPIC_API_KEY env var. */
  api_key?: string;
}

/**
 * Load the "claude" section from .n-dx.json in the given project directory.
 * Returns an empty object if the file doesn't exist, is invalid, or has no claude section.
 *
 * @param projectDir The project root directory containing .n-dx.json
 */
export async function loadClaudeConfig(
  projectDir: string,
): Promise<ClaudeConfig> {
  const configPath = join(projectDir, PROJECT_CONFIG_FILE);
  try {
    await access(configPath);
    const raw = await readFile(configPath, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && data.claude && typeof data.claude === "object") {
      const claude = data.claude as Record<string, unknown>;
      const result: ClaudeConfig = {};
      if (typeof claude.cli_path === "string" && claude.cli_path) {
        result.cli_path = claude.cli_path;
      }
      if (typeof claude.api_key === "string" && claude.api_key) {
        result.api_key = claude.api_key;
      }
      return result;
    }
  } catch {
    // File doesn't exist or is invalid — no claude config
  }
  return {};
}

/**
 * Resolve the Claude CLI binary path with the following priority:
 * 1. claude.cli_path from unified config (.n-dx.json)
 * 2. "claude" (found on PATH)
 *
 * @returns The resolved binary path.
 */
export function resolveCliPath(claudeConfig: ClaudeConfig): string {
  return claudeConfig.cli_path ?? "claude";
}
