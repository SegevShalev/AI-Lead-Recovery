import type { Env } from "@ai-lead-recovery/config";

export function describeStartup(env: Env): string {
  return `[recovery-worker] starting (env=${env.NODE_ENV}, queueProvider=${env.QUEUE_PROVIDER})`;
}
