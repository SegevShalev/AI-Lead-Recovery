import { loadEnv } from "@ai-lead-recovery/config";
import { createApp } from "./app.js";

const env = loadEnv();
const port = env.PORT ?? 3001;

const app = createApp();
app.listen(port, () => {
  console.log(
    `[ai-service] listening on port ${port} (env=${env.NODE_ENV}, provider=${env.AI_PROVIDER})`,
  );
});
