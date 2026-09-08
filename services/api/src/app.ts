import express, { type Express } from "express";
import type { SuggestionClient } from "./aiServiceClient.js";
import { createBusinessesRouter } from "./routes/businesses.js";
import { createDashboardRouter, type DashboardCacheClient } from "./routes/dashboard.js";
import { createRecoveryCasesRouter } from "./routes/recoveryCases.js";
import { createSuggestionRouter } from "./routes/suggestions.js";
import { createWebhooksRouter, type EventPublisher } from "./routes/webhooks.js";

export interface AppDeps {
  queue: EventPublisher;
  cache: DashboardCacheClient;
  suggestionClient: SuggestionClient;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "api" });
  });

  app.use(createWebhooksRouter({ queue: deps.queue }));
  app.use(createBusinessesRouter());
  app.use(createDashboardRouter({ cache: deps.cache }));
  app.use(createRecoveryCasesRouter());
  app.use(createSuggestionRouter({ suggestionClient: deps.suggestionClient }));

  return app;
}
