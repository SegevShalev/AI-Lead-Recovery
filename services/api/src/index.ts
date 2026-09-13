import { loadEnv } from "@ai-lead-recovery/config";
import { connectMongo } from "@ai-lead-recovery/db";
import { createQueueFromEnv } from "@ai-lead-recovery/queue";
import { createClient } from "redis";
import { createHttpSuggestionClient } from "./aiServiceClient.js";
import { createApp } from "./app.js";

const env = loadEnv();
const port = env.PORT ?? 3000;

await connectMongo(env.MONGODB_URI);
const queue = createQueueFromEnv(env, "conversation-events");
const suggestionClient = createHttpSuggestionClient(env.AI_SERVICE_URL);

const cacheRedis = createClient({ url: env.REDIS_URL });
cacheRedis.on("error", (err) => console.error("[api] cache redis error", err));
await cacheRedis.connect();

const app = createApp({ queue, cache: cacheRedis, suggestionClient });
app.listen(port, () => {
  console.log(`[api] listening on port ${port} (env=${env.NODE_ENV})`);
});
