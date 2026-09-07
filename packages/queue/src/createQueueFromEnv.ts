import { createRedisListQueue, type Queue } from "./redisQueue.js";
import { createSqsQueue } from "./sqsQueue.js";

export interface QueueEnv {
  QUEUE_PROVIDER: "local" | "sqs";
  REDIS_URL: string;
  SQS_QUEUE_URL?: string | undefined;
  AWS_REGION?: string | undefined;
}

/**
 * Single place that turns QUEUE_PROVIDER into a concrete adapter, so
 * services/api and services/recovery-worker don't duplicate the branch.
 * `loadEnv`'s schema already enforces SQS_QUEUE_URL/AWS_REGION are set
 * when QUEUE_PROVIDER=sqs, but re-checked here since callers can pass
 * any QueueEnv-shaped object.
 */
export function createQueueFromEnv(env: QueueEnv, queueName: string): Queue {
  if (env.QUEUE_PROVIDER === "sqs") {
    if (!env.SQS_QUEUE_URL || !env.AWS_REGION) {
      throw new Error("QUEUE_PROVIDER=sqs requires SQS_QUEUE_URL and AWS_REGION to be set");
    }
    return createSqsQueue(env.SQS_QUEUE_URL, env.AWS_REGION);
  }
  return createRedisListQueue(env.REDIS_URL, queueName);
}
