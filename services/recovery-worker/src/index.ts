import { loadEnv } from "@ai-lead-recovery/config";
import { connectMongo } from "@ai-lead-recovery/db";
import { createQueueFromEnv } from "@ai-lead-recovery/queue";
import type { ConversationMessageReceivedEvent } from "@ai-lead-recovery/shared";
import { createClient } from "redis";
import { describeStartup, handleConversationMessageReceived } from "./worker.js";

const env = loadEnv();
console.log(describeStartup(env));

await connectMongo(env.MONGODB_URI);

const idempotencyRedis = createClient({ url: env.REDIS_URL });
await idempotencyRedis.connect();

const queue = createQueueFromEnv(env, "conversation-events");

await queue.consume(async (event) => {
  if (event.eventType !== "conversation.message.received") return;
  await handleConversationMessageReceived(event as ConversationMessageReceivedEvent, {
    redis: idempotencyRedis,
    thresholdMinutes: env.UNANSWERED_THRESHOLD_MINUTES,
  });
});
