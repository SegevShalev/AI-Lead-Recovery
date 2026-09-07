import { loadEnv } from "@ai-lead-recovery/config";
import { connectMongo } from "@ai-lead-recovery/db";
import { createQueueFromEnv } from "@ai-lead-recovery/queue";
import {
  createLogger,
  dashboardCacheVersionKey,
  type ConversationMessageReceivedEvent,
} from "@ai-lead-recovery/shared";
import { createClient } from "redis";
import { createApp } from "./app.js";
import { describeStartup, handleConversationMessageReceived } from "./worker.js";

const env = loadEnv();
const logger = createLogger("recovery-worker");
console.log(describeStartup(env));

await connectMongo(env.MONGODB_URI);

const idempotencyRedis = createClient({ url: env.REDIS_URL });
idempotencyRedis.on("error", (err) =>
  logger.error("idempotency redis error", {
    error: err instanceof Error ? err.message : String(err),
  }),
);
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

const queue = createQueueFromEnv(env, "conversation-events");

await queue.consume(async (event) => {
  if (event.eventType !== "conversation.message.received") return;
  await handleConversationMessageReceived(event as ConversationMessageReceivedEvent, {
    redis: idempotencyRedis,
    thresholdMinutes: env.UNANSWERED_THRESHOLD_MINUTES,
    logger,
    invalidateDashboardCache: async (businessId) => {
      await idempotencyRedis.incr(dashboardCacheVersionKey(businessId));
    },
  });
  lastEventProcessedAt = new Date();
});
