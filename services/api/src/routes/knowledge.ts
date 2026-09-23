import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { mongoose } from "@ai-lead-recovery/db";
import {
  createLogger,
  knowledgeDocumentInputSchema,
  type KnowledgeDocumentType,
} from "@ai-lead-recovery/shared";
import { Business, BusinessKnowledgeDocument } from "../db/models.js";
import type { KnowledgeIndexClient } from "../knowledgeIndexClient.js";

const logger = createLogger("api");

type KnowledgeDocumentRecord = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  type: KnowledgeDocumentType;
  title: string;
  content: string;
  version: number;
};

/**
 * Owner-facing CRUD for BusinessKnowledgeDocument
 * (docs/development/phase-4-checklist.md Track 2). Every query is scoped by
 * the path's businessId, so a valid document id from another business is a
 * 404, never a read or write.
 *
 * Every write bumps `version` and synchronously asks the AI service to
 * (re)index. The document is only marked "indexed" when the AI service
 * confirms; if it's unreachable the edit is still saved, as "pending", and
 * the reindex route retries. Contents are never logged.
 */
export function createKnowledgeRouter(deps: {
  knowledgeIndexClient: KnowledgeIndexClient;
}): Router {
  const router = Router();

  /** Sends the stored version to the AI service; marks it indexed only if that version is still current. */
  async function syncIndex(doc: KnowledgeDocumentRecord, correlationId: string): Promise<void> {
    const result = await deps.knowledgeIndexClient.indexDocument({
      businessId: String(doc.businessId),
      documentId: String(doc._id),
      version: doc.version,
      type: doc.type,
      title: doc.title,
      content: doc.content,
      correlationId,
    });
    const logFields = {
      correlationId,
      businessId: String(doc.businessId),
      documentId: String(doc._id),
      version: doc.version,
    };

    if (!result.ok) {
      logger.warn("knowledge indexing failed, left pending", {
        ...logFields,
        clientError: result.errorCode,
      });
      return;
    }

    // Conditional on version: if another edit landed meanwhile, that edit's
    // own sync decides the status — never mark a newer version as indexed.
    await BusinessKnowledgeDocument.updateOne(
      { _id: doc._id, version: doc.version },
      { indexStatus: "indexed" },
    );
    logger.info("knowledge document indexed", { ...logFields, chunkCount: result.data.chunkCount });
  }

  async function sendDocument(res: Response, status: number, documentId: mongoose.Types.ObjectId) {
    const doc = await BusinessKnowledgeDocument.findById(documentId).lean();
    res.status(status).json({ document: doc });
  }

  /** Malformed ids are a 404, same as the other API routes. Returns false if it responded. */
  function idsAreValid(res: Response, businessId: string, documentId?: string): boolean {
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      res.status(404).json({ error: "business_not_found" });
      return false;
    }
    if (documentId !== undefined && !mongoose.Types.ObjectId.isValid(documentId)) {
      res.status(404).json({ error: "knowledge_document_not_found" });
      return false;
    }
    return true;
  }

  router.get("/api/businesses/:businessId/knowledge", async (req, res) => {
    const { businessId } = req.params;
    if (!idsAreValid(res, businessId)) return;

    const documents = await BusinessKnowledgeDocument.find({ businessId })
      .sort({ type: 1, title: 1 })
      .lean();
    res.json({ documents });
  });

  router.post("/api/businesses/:businessId/knowledge", async (req, res) => {
    const { businessId } = req.params;
    if (!idsAreValid(res, businessId)) return;
    const input = knowledgeDocumentInputSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "invalid_knowledge_document", issues: input.error.issues });
      return;
    }
    if (!(await Business.exists({ _id: businessId }))) {
      res.status(404).json({ error: "business_not_found" });
      return;
    }

    const doc = await BusinessKnowledgeDocument.create({
      businessId,
      ...input.data,
      version: 1,
      indexStatus: "pending",
    });
    await syncIndex(doc, randomUUID());
    await sendDocument(res, 201, doc._id);
  });

  router.put("/api/businesses/:businessId/knowledge/:documentId", async (req, res) => {
    const { businessId, documentId } = req.params;
    if (!idsAreValid(res, businessId, documentId)) return;
    const input = knowledgeDocumentInputSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "invalid_knowledge_document", issues: input.error.issues });
      return;
    }

    // Atomic bump, so two concurrent edits get two different versions.
    const doc = await BusinessKnowledgeDocument.findOneAndUpdate(
      { _id: documentId, businessId },
      {
        $set: { ...input.data, indexStatus: "pending" },
        $inc: { version: 1 },
        ...(input.data.metadata === undefined ? { $unset: { metadata: 1 } } : {}),
      },
      { new: true },
    ).lean();
    if (!doc) {
      res.status(404).json({ error: "knowledge_document_not_found" });
      return;
    }

    await syncIndex(doc, randomUUID());
    await sendDocument(res, 200, doc._id);
  });

  router.post("/api/businesses/:businessId/knowledge/:documentId/reindex", async (req, res) => {
    const { businessId, documentId } = req.params;
    if (!idsAreValid(res, businessId, documentId)) return;

    const doc = await BusinessKnowledgeDocument.findOne({
      _id: documentId,
      businessId,
    }).lean();
    if (!doc) {
      res.status(404).json({ error: "knowledge_document_not_found" });
      return;
    }

    await syncIndex(doc, randomUUID());
    await sendDocument(res, 200, doc._id);
  });

  /**
   * Removes from the AI index *first*: deleting only in Mongo while the AI
   * service is down would leave the old chunks retrievable, so a price the
   * owner deleted could still reach a suggestion. If the index can't be
   * reached, nothing is deleted and the owner is asked to retry (503).
   */
  router.delete("/api/businesses/:businessId/knowledge/:documentId", async (req, res) => {
    const { businessId, documentId } = req.params;
    if (!idsAreValid(res, businessId, documentId)) return;

    const doc = await BusinessKnowledgeDocument.findOne({
      _id: documentId,
      businessId,
    }).lean();
    if (!doc) {
      res.status(404).json({ error: "knowledge_document_not_found" });
      return;
    }

    const correlationId = randomUUID();
    const result = await deps.knowledgeIndexClient.deleteDocument(
      businessId,
      String(doc._id),
      correlationId,
    );
    if (!result.ok) {
      logger.warn("knowledge index delete failed, document kept", {
        correlationId,
        businessId,
        documentId: String(doc._id),
        clientError: result.errorCode,
      });
      res.status(503).json({ error: "knowledge_index_unavailable" });
      return;
    }

    await BusinessKnowledgeDocument.deleteOne({ _id: doc._id });
    logger.info("knowledge document deleted", {
      correlationId,
      businessId,
      documentId: String(doc._id),
    });
    res.status(204).end();
  });

  return router;
}
