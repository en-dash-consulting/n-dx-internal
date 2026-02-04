import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import type { PRDStore } from "rex/dist/store/types.js";
import type { HenchConfig, RunRecord } from "../schema/index.js";
import { GuardRails } from "../guard/index.js";
import { TOOL_DEFINITIONS, dispatchTool } from "./tools.js";
import type { ToolContext } from "./tools.js";
import { assembleTaskBrief, formatTaskBrief } from "./brief.js";
import { buildSystemPrompt } from "./prompt.js";
import { saveRun } from "../store/index.js";

export interface AgentLoopOptions {
  config: HenchConfig;
  store: PRDStore;
  projectDir: string;
  henchDir: string;
  taskId?: string;
  dryRun?: boolean;
  maxTurns?: number;
  model?: string;
}

export interface AgentLoopResult {
  run: RunRecord;
}

const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 529]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_CONTEXT_PAIRS = 20;
const MAX_SUMMARY_LENGTH = 500;
const MAX_TOOL_OUTPUT_STORED = 2000;

async function callWithRetry(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      lastError = err as Error;
      const status = (err as { status?: number }).status;

      if (status && RETRY_STATUS_CODES.has(status) && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(`  [Retry] API returned ${status}, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}

function pruneMessages(messages: Anthropic.MessageParam[]): void {
  // Keep first message (the task brief) and last MAX_CONTEXT_PAIRS turn-pairs.
  // Turn-pairs are (assistant, user) so each pair = 2 messages.
  const maxKeep = 1 + MAX_CONTEXT_PAIRS * 2;

  if (messages.length <= maxKeep) return;

  const removed = messages.length - maxKeep;
  messages.splice(1, removed);
  console.log(`  [Context] Pruned ${removed} messages to stay within token budget`);
}

export async function agentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const { config, store, projectDir, henchDir, dryRun } = opts;
  const maxTurns = opts.maxTurns ?? config.maxTurns;
  const model = opts.model ?? config.model;

  // Assemble brief
  const { brief, taskId } = await assembleTaskBrief(store, opts.taskId);
  const briefText = formatTaskBrief(brief);

  if (dryRun) {
    console.log("=== DRY RUN ===");
    console.log("\n--- System Prompt ---");
    console.log(buildSystemPrompt(brief.project, config));
    console.log("\n--- Task Brief ---");
    console.log(briefText);
    console.log("\n--- Tools ---");
    console.log(TOOL_DEFINITIONS.map((t) => t.name).join(", "));

    const run: RunRecord = {
      id: randomUUID(),
      taskId,
      taskTitle: brief.task.title,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed",
      turns: 0,
      summary: "Dry run — no API calls made",
      tokenUsage: { input: 0, output: 0 },
      toolCalls: [],
      model,
    };

    return { run };
  }

  // Get API key
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `API key not found. Set ${config.apiKeyEnv} environment variable.`,
    );
  }

  const client = new Anthropic({ apiKey });
  const guard = new GuardRails(projectDir, config.guard);

  const toolCtx: ToolContext = {
    guard,
    projectDir,
    store,
    taskId,
  };

  const run: RunRecord = {
    id: randomUUID(),
    taskId,
    taskTitle: brief.task.title,
    startedAt: new Date().toISOString(),
    status: "running",
    turns: 0,
    tokenUsage: { input: 0, output: 0 },
    toolCalls: [],
    model,
  };

  await saveRun(henchDir, run);

  const systemPrompt = buildSystemPrompt(brief.project, config);

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: briefText },
  ];

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      run.turns = turn + 1;

      console.log(`\n--- Turn ${turn + 1}/${maxTurns} ---`);

      pruneMessages(messages);

      const response = await callWithRetry(client, {
        model,
        max_tokens: config.maxTokens,
        system: systemPrompt,
        tools: TOOL_DEFINITIONS,
        messages,
      });

      // Track token usage
      run.tokenUsage.input += response.usage.input_tokens;
      run.tokenUsage.output += response.usage.output_tokens;

      // Process response content
      const assistantContent = response.content;
      messages.push({ role: "assistant", content: assistantContent });

      // Print text output
      for (const block of assistantContent) {
        if (block.type === "text" && block.text) {
          console.log(`[Agent] ${block.text}`);
        }
      }

      // Handle stop reasons
      if (response.stop_reason === "end_turn") {
        run.status = "completed";
        for (const block of [...assistantContent].reverse()) {
          if (block.type === "text") {
            run.summary = block.text.slice(0, MAX_SUMMARY_LENGTH);
            break;
          }
        }
        break;
      }

      if (response.stop_reason === "max_tokens") {
        console.log("  [Warning] Response truncated (max_tokens). Continuing...");
        // Send a continuation prompt so the agent can finish its thought
        messages.push({
          role: "user",
          content: "Your response was truncated due to length. Please continue where you left off. If you were in the middle of a tool call, please retry it.",
        });
        continue;
      }

      if (response.stop_reason !== "tool_use") {
        run.status = "completed";
        break;
      }

      // Process tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of assistantContent) {
        if (block.type !== "tool_use") continue;

        const startMs = Date.now();
        console.log(`  [Tool] ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`);

        const output = await dispatchTool(
          toolCtx,
          block.name,
          block.input as Record<string, unknown>,
        );

        const durationMs = Date.now() - startMs;

        run.toolCalls.push({
          turn: turn + 1,
          tool: block.name,
          input: block.input as Record<string, unknown>,
          output: output.slice(0, MAX_TOOL_OUTPUT_STORED),
          durationMs,
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output,
        });

        console.log(`  [Result] ${output.slice(0, 200)}${output.length > 200 ? "..." : ""}`);
      }

      messages.push({ role: "user", content: toolResults });

      // Save progress periodically
      await saveRun(henchDir, run);
    }

    if (run.status === "running") {
      run.status = "timeout";
      run.error = `Exceeded max turns (${maxTurns})`;
    }
  } catch (err) {
    run.status = "failed";
    run.error = (err as Error).message;
    console.error(`[Error] ${run.error}`);
  }

  run.finishedAt = new Date().toISOString();
  await saveRun(henchDir, run);

  return { run };
}
