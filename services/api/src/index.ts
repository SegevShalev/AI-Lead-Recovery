import { loadEnv } from "@ai-lead-recovery/config";
import { connectMongo } from "@ai-lead-recovery/db";
import { createRedisListQueue } from "@ai-lead-recovery/queue";
import { createClient } from "redis";
import { createApp } from "./app.js";

const env = loadEnv();
const port = env.PORT ?? 3000;

if (env.QUEUE_PROVIDER !== "local") {
  throw new Error(`QUEUE_PROVIDER=${env.QUEUE_PROVIDER} is not implemented until Phase 2`);
}

await connectMongo(env.MONGODB_URI);
const queue = createRedisListQueue(env.REDIS_URL, "conversation-events");

const cacheRedis = createClient({ url: env.REDIS_URL });
await cacheRedis.connect();

const app = createApp({ queue, cache: cacheRedis });
app.listen(port, () => {
  console.log(`[api] listening on port ${port} (env=${env.NODE_ENV})`);
});
