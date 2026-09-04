import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().optional(),
  WORKER_PORT: z.coerce.number().int().positive().optional(),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  QUEUE_PROVIDER: z.enum(["local", "sqs"]).default("local"),
  SQS_QUEUE_URL: z.string().optional(),
  AI_PROVIDER: z.enum(["mock", "openai", "anthropic", "bedrock"]).default("mock"),
  AI_API_KEY: z.string().optional(),
  UNANSWERED_THRESHOLD_MINUTES: z.coerce.number().int().positive().default(60),
});
export type Env = z.infer<typeof envSchema>;

/**
 * Fails fast: a service with invalid/missing config should not start.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  return result.data;
}
