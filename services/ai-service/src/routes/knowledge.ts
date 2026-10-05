import {
  deleteDocumentParamsSchema,
  indexDocumentRequestSchema,
  type Logger,
} from "@ai-lead-recovery/shared";
import { Router, type Response } from "express";
import { EmbeddingError } from "../knowledge/embedder.js";
import type { KnowledgeIndexer } from "../knowledge/knowledgeIndexer.js";
import { VectorStoreError } from "../knowledge/vectorStore.js";

/**
 * Contract: docs/development/phase-4-checklist.md "Contract additions".
 * Any non-2xx makes services/api save the document as indexStatus "pending"
 * and offer a reindex, so failing loudly here never loses the owner's edit.
 */
export function createKnowledgeRouter(indexer: KnowledgeIndexer, logger: Logger): Router {
  const router = Router();

  router.post("/internal/knowledge/index", async (req, res) => {
    const parsed = indexDocumentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
      return;
    }
    try {
      res.status(200).json(await indexer.index(parsed.data));
    } catch (error) {
      sendIndexError(res, error, logger, "knowledge index failed", {
        correlationId: parsed.data.correlationId,
        businessId: parsed.data.businessId,
        documentId: parsed.data.documentId,
      });
    }
  });

  router.delete("/internal/knowledge/:businessId/:documentId", async (req, res) => {
    const parsed = deleteDocumentParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
      return;
    }
    const correlationId = req.header("x-correlation-id");
    try {
      await indexer.delete(parsed.data.businessId, parsed.data.documentId, correlationId);
      res.status(204).end();
    } catch (error) {
      sendIndexError(res, error, logger, "knowledge delete failed", {
        correlationId,
        ...parsed.data,
      });
    }
  });

  return router;
}

/**
 * Express 4 does not catch errors thrown by async handlers (the request
 * would just hang), so every failure is mapped here explicitly.
 */
function sendIndexError(
  res: Response,
  error: unknown,
  logger: Logger,
  message: string,
  fields: Record<string, unknown>,
): void {
  // The document itself can't be embedded (e.g. the provider rejects it):
  // retrying the same content won't help.
  if (error instanceof EmbeddingError && error.code === "invalid_input") {
    logger.warn(message, { ...fields, errorCode: error.code });
    res.status(422).json({ error: "unprocessable_document", code: error.code });
    return;
  }
  // Embedding provider or Qdrant down/slow: worth a later reindex.
  if (error instanceof EmbeddingError || error instanceof VectorStoreError) {
    const code = error instanceof EmbeddingError ? error.code : "vector_store_unavailable";
    logger.warn(message, { ...fields, errorCode: code, error: error.message });
    res.status(503).json({ error: "index_unavailable", code });
    return;
  }
  logger.error(message, {
    ...fields,
    error: error instanceof Error ? error.message : "unknown error",
  });
  res.status(500).json({ error: "internal_error" });
}
