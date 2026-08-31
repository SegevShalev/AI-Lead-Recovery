import express, { type Express } from "express";
import { createBusinessesRouter } from "./routes/businesses.js";
import { createDashboardRouter } from "./routes/dashboard.js";
import { createRecoveryCasesRouter } from "./routes/recoveryCases.js";
import { createWebhooksRouter, type EventPublisher } from "./routes/webhooks.js";

export interface AppDeps {
  queue: EventPublisher;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "api" });
  });

  app.use(createWebhooksRouter({ queue: deps.queue }));
  app.use(createBusinessesRouter());
  app.use(createDashboardRouter());
  app.use(createRecoveryCasesRouter());

  return app;
}
