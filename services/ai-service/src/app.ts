import type { Logger } from "@ai-lead-recovery/shared";
import express, { type Express } from "express";
import type { KnowledgeIndexer } from "./knowledge/knowledgeIndexer.js";
import { createKnowledgeRouter } from "./routes/knowledge.js";
import { createSuggestionsRouter } from "./routes/suggestions.js";
import type { SuggestionGenerator } from "./suggestionGenerator.js";

export function createApp(
  generator: SuggestionGenerator,
  indexer: KnowledgeIndexer,
  logger: Logger,
): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "ai-service" });
  });

  app.use(createSuggestionsRouter(generator));
  app.use(createKnowledgeRouter(indexer, logger));

  return app;
}
