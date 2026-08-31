import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  QUEUE_PROVIDER: z.enum(["local", "sqs"]).default("local"),
  SQS_QUEUE_URL: z.string().optional(),
  AI_PROVIDER: z.enum(["mock", "openai", "anthropic", "bedrock"]).default("mock"),
  AI_API_KEY: z.string().optional(),
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
