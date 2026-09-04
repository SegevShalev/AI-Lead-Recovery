import { loadEnv } from "@ai-lead-recovery/config";
import { connectMongo } from "@ai-lead-recovery/db";
import { createQueueFromEnv } from "@ai-lead-recovery/queue";
import { createApp } from "./app.js";

const env = loadEnv();
const port = env.PORT ?? 3000;

await connectMongo(env.MONGODB_URI);
const queue = createQueueFromEnv(env, "conversation-events");

const app = createApp({ queue });
app.listen(port, () => {
  console.log(`[api] listening on port ${port} (env=${env.NODE_ENV})`);
});
