import express, { type Express } from "express";
import { createSuggestionsRouter } from "./routes/suggestions.js";
import type { SuggestionGenerator } from "./suggestionGenerator.js";

export function createApp(generator: SuggestionGenerator): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "ai-service" });
  });

  app.use(createSuggestionsRouter(generator));

  return app;
}
