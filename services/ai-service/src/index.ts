import { loadEnv } from "@ai-lead-recovery/config";
import { createLogger } from "@ai-lead-recovery/shared";
import { createApp } from "./app.js";
import { createProvidersFromEnv } from "./providerFactory.js";
import { SuggestionGenerator } from "./suggestionGenerator.js";

const env = loadEnv();
const port = env.PORT ?? 3001;
const logger = createLogger("ai-service");

const { primary, fallback } = createProvidersFromEnv(env);
const generator = new SuggestionGenerator(primary, fallback, logger);

const app = createApp(generator);
app.listen(port, () => {
  console.log(
    `[ai-service] listening on port ${port} (env=${env.NODE_ENV}, provider=${env.AI_PROVIDER}, fallback=${env.AI_FALLBACK_PROVIDER ?? "none"})`,
  );
});
