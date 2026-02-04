import { z, ZodError } from "zod";

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: ZodError };

const GuardConfigSchema = z.object({
  blockedPaths: z.array(z.string()),
  allowedCommands: z.array(z.string()),
  commandTimeout: z.number().positive(),
  maxFileSize: z.number().positive(),
});

export const HenchConfigSchema = z.object({
  schema: z.string(),
  provider: z.enum(["cli", "api"]).default("cli"),
  model: z.string(),
  maxTurns: z.number().positive(),
  maxTokens: z.number().positive(),
  rexDir: z.string(),
  apiKeyEnv: z.string(),
  guard: GuardConfigSchema,
});

const RunStatusSchema = z.enum(["running", "completed", "failed", "timeout"]);

const ToolCallRecordSchema = z.object({
  turn: z.number(),
  tool: z.string(),
  input: z.record(z.unknown()),
  output: z.string(),
  durationMs: z.number(),
});

const TokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
});

export const RunRecordSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  taskTitle: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: RunStatusSchema,
  turns: z.number(),
  summary: z.string().optional(),
  error: z.string().optional(),
  tokenUsage: TokenUsageSchema,
  toolCalls: z.array(ToolCallRecordSchema),
  model: z.string(),
});

export function validateConfig(
  data: unknown,
): ValidationResult<z.infer<typeof HenchConfigSchema>> {
  const result = HenchConfigSchema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: result.error };
}

export function validateRunRecord(
  data: unknown,
): ValidationResult<z.infer<typeof RunRecordSchema>> {
  const result = RunRecordSchema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: result.error };
}
