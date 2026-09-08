import { randomUUID } from "node:crypto";
import { Router } from "express";
import { mongoose } from "@ai-lead-recovery/db";
import {
  createLogger,
  suggestionRequestSchema,
  type ApiSuggestionResponse,
  type MessageDirection,
} from "@ai-lead-recovery/shared";
import { Message, RecoveryCase, Suggestion } from "../db/models.js";
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
    });

    const body: ApiSuggestionResponse = { ...result.data, suggestionId: String(suggestion._id) };
    res.json(body);
  });

  return router;
}
