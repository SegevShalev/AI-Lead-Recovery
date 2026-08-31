import { loadEnv } from "@ai-lead-recovery/config";
import { createApp } from "./app.js";

const env = loadEnv();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = createApp();
app.listen(port, () => {
  console.log(`[api] listening on port ${port} (env=${env.NODE_ENV})`);
});
