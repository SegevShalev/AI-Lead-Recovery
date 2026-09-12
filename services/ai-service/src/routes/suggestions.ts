import { suggestionRequestSchema } from "@ai-lead-recovery/shared";
import { Router } from "express";
import type { SuggestionGenerator } from "../suggestionGenerator.js";

export function createSuggestionsRouter(generator: SuggestionGenerator): Router {
  const router = Router();

  router.post("/internal/suggestions", async (req, res) => {
    const parsed = suggestionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
      return;
    }

    const result = await generator.generate(parsed.data);
    res.status(200).json(result);
  });

  return router;
}
