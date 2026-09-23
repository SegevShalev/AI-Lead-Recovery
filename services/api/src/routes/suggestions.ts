import { randomUUID } from "node:crypto";
import { Router } from "express";
import { mongoose } from "@ai-lead-recovery/db";
import {
  createLogger,
  suggestionRequestSchema,
  type ApiSuggestionResponse,
  type MessageDirection,
} from "@ai-lead-recovery/shared";
import { BusinessKnowledgeDocument, Message, RecoveryCase, Suggestion } from "../db/models.js";
import type { SuggestionClient } from "../aiServiceClient.js";

const logger = createLogger("api");

/**
 * Same window the contract fixes in docs/development/phase-3-checklist.md:
 * the last outbound (business) message plus everything after it, capped at
 * 10 — covers the "unanswered" rule (includes the message that never got a
 * reply) without needing per-case-type selection yet.
 */
const CONTEXT_MESSAGE_LIMIT = 10;

interface ContextMessage {
  direction: MessageDirection;
  text: string;
  occurredAt: Date;
}

export function selectConversationContext(
  messages: ContextMessage[],
): { direction: MessageDirection; text: string; occurredAt: string }[] {
  const lastOutboundIndex = messages.map((m) => m.direction).lastIndexOf("outbound");
  const relevant = lastOutboundIndex === -1 ? messages : messages.slice(lastOutboundIndex);
  const [anchor, ...rest] = relevant;
  const capped =
    !anchor || relevant.length <= CONTEXT_MESSAGE_LIMIT
      ? relevant
      : [anchor, ...rest.slice(-(CONTEXT_MESSAGE_LIMIT - 1))];
  return capped.map((m) => ({
    direction: m.direction,
    text: m.text,
    occurredAt: m.occurredAt.toISOString(),
  }));
}

/**
 * Titles for the documents a suggestion was grounded on, looked up in the
 * API's own collection. Scoped by businessId: an id the AI service returned
 * for another business (which would be a retrieval bug) is dropped, never
 * shown. Deleted documents are dropped too; order follows first appearance.
 */
export async function resolveKnowledgeDocuments(
  businessId: mongoose.Types.ObjectId,
  documentIds: string[],
): Promise<{ documentId: string; title: string }[]> {
  const uniqueIds = [...new Set(documentIds)].filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (uniqueIds.length === 0) return [];
  const docs = await BusinessKnowledgeDocument.find({ _id: { $in: uniqueIds }, businessId })
    .select("title")
    .lean();
  const titleById = new Map(docs.map((doc) => [String(doc._id), doc.title]));
  return uniqueIds.flatMap((id) => {
    const title = titleById.get(id);
    return title === undefined ? [] : [{ documentId: id, title }];
  });
}

type PopulatedCustomer = { _id: mongoose.Types.ObjectId; displayName: string; phone: string };

/**
 * Generates (and persists) an AI follow-up suggestion for one recovery case
 * (docs/architecture/service-boundaries.md#servicesapi,
 * docs/development/phase-3-checklist.md Track 2). Doesn't call an AI
 * provider itself — that's services/ai-service's job; this only builds the
 * request, calls it, and handles the result.
 */
export function createSuggestionRouter(deps: { suggestionClient: SuggestionClient }): Router {
  const router = Router();

  router.post("/api/recovery-cases/:id/suggestion", async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ error: "recovery_case_not_found" });
      return;
    }

    const recoveryCase = await RecoveryCase.findById(id)
      .populate<{ customerId: PopulatedCustomer }>("customerId", "displayName phone")
      .lean();
    if (!recoveryCase) {
      res.status(404).json({ error: "recovery_case_not_found" });
      return;
    }
    if (!recoveryCase.customerId) {
      res.status(404).json({ error: "recovery_case_not_found" });
      return;
    }

    const messages = await Message.find({ conversationId: recoveryCase.conversationId })
      .sort({ occurredAt: 1 })
      .select("direction text occurredAt")
      .lean();

    const correlationId = randomUUID();
    const logFields = { correlationId, recoveryCaseId: String(recoveryCase._id) };

    const suggestionRequest = suggestionRequestSchema.parse({
      recoveryCaseId: String(recoveryCase._id),
      businessId: String(recoveryCase.businessId),
      caseType: recoveryCase.type,
      reason: recoveryCase.reason,
      estimatedValue: recoveryCase.estimatedValue,
      customer: {
        displayName: recoveryCase.customerId.displayName,
        phone: recoveryCase.customerId.phone,
      },
      conversationContext: selectConversationContext(messages),
      correlationId,
    });

    const result = await deps.suggestionClient.requestSuggestion(suggestionRequest);

    if (!result.ok) {
      logger.warn("suggestion request failed", { ...logFields, clientError: result.errorCode });
      const body: ApiSuggestionResponse = { status: "degraded", errorCode: "provider_unavailable" };
      res.json(body);
      return;
    }

    if (result.data.status === "degraded") {
      logger.warn("ai service returned a degraded result", {
        ...logFields,
        errorCode: result.data.errorCode,
      });
      res.json(result.data satisfies ApiSuggestionResponse);
      return;
    }

    const suggestion = await Suggestion.create({
      recoveryCaseId: recoveryCase._id,
      businessId: recoveryCase.businessId,
      language: result.data.language,
      message: result.data.message,
      reasoningSummary: result.data.reason,
      model: result.data.model,
      promptVersion: result.data.promptVersion,
      retrievalStatus: result.data.retrieval.status,
      retrievalContextVersion: result.data.retrieval.contextVersion,
      retrievalSources: result.data.retrieval.sources,
    });
    await RecoveryCase.updateOne(
      { _id: recoveryCase._id },
      { suggestionId: String(suggestion._id) },
    );

    logger.info("suggestion generated", {
      ...logFields,
      suggestionId: String(suggestion._id),
      model: result.data.model,
      promptVersion: result.data.promptVersion,
      retrievalStatus: result.data.retrieval.status,
      retrievalSourceCount: result.data.retrieval.sources.length,
    });

    const body: ApiSuggestionResponse = {
      ...result.data,
      suggestionId: String(suggestion._id),
      knowledgeDocuments: await resolveKnowledgeDocuments(
        recoveryCase.businessId,
        result.data.retrieval.sources.map((source) => source.documentId),
      ),
    };
    res.json(body);
  });

  return router;
}
