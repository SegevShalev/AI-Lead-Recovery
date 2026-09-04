import { loadEnv } from "@ai-lead-recovery/config";
import { connectMongo } from "@ai-lead-recovery/db";
import { createRedisListQueue } from "@ai-lead-recovery/queue";
import {
  createLogger,
  dashboardCacheKey,
  type ConversationMessageReceivedEvent,
} from "@ai-lead-recovery/shared";
import { createClient } from "redis";
import { createApp } from "./app.js";
import { describeStartup, handleConversationMessageReceived } from "./worker.js";

const env = loadEnv();
const logger = createLogger("recovery-worker");
console.log(describeStartup(env));

if (env.QUEUE_PROVIDER !== "local") {
  throw new Error(`QUEUE_PROVIDER=${env.QUEUE_PROVIDER} is not implemented until Phase 2`);
}

await connectMongo(env.MONGODB_URI);

const idempotencyRedis = createClient({ url: env.REDIS_URL });
await idempotencyRedis.connect();

let lastEventProcessedAt: Date | null = null;
const healthApp = createApp({
  isRedisConnected: () => idempotencyRedis.isOpen,
  lastEventProcessedAt: () => lastEventProcessedAt,
});
const workerPort = env.WORKER_PORT ?? 3002;
healthApp.listen(workerPort, () => {
  console.log(`[recovery-worker] health check listening on port ${workerPort}`);
});

const queue = createRedisListQueue(env.REDIS_URL, "conversation-events");

await queue.consume(async (event) => {
  if (event.eventType !== "conversation.message.received") return;
  await handleConversationMessageReceived(event as ConversationMessageReceivedEvent, {
    redis: idempotencyRedis,
    thresholdMinutes: env.UNANSWERED_THRESHOLD_MINUTES,
    logger,
    invalidateDashboardCache: async (businessId) => {
      await idempotencyRedis.del(dashboardCacheKey(businessId));
    },
  });
  lastEventProcessedAt = new Date();
});
