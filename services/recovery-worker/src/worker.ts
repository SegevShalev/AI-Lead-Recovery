import type { Env } from "@ai-lead-recovery/config";
import { markProcessed, type RedisStringClient } from "@ai-lead-recovery/queue";
import type { ConversationMessageReceivedEvent, Logger } from "@ai-lead-recovery/shared";
import { Business, Conversation, Message, RecoveryCase } from "./db/models.js";
import { evaluateUnanswered } from "./rules/unanswered.js";

export function describeStartup(env: Env): string {
  return `[recovery-worker] starting (env=${env.NODE_ENV}, queueProvider=${env.QUEUE_PROVIDER})`;
}

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export interface WorkerDeps {
  redis: RedisStringClient;
  thresholdMinutes: number;
  logger: Logger;
  /** Dashboard aggregate cache is only ever stale by writes made here (docs/architecture/service-boundaries.md#redis-usage). */
  invalidateDashboardCache: (businessId: string) => Promise<void>;
}

/**
 * Owns recovery-case creation/update for the "unanswered" rule
 * (docs/architecture/service-boundaries.md). Consumers must tolerate
 * duplicate delivery, hence the idempotency check up front.
 */
export async function handleConversationMessageReceived(
  event: ConversationMessageReceivedEvent,
  deps: WorkerDeps,
): Promise<void> {
  const correlationId = event.correlationId ?? event.eventId;
  const logFields = { correlationId, eventId: event.eventId, conversationId: event.conversationId };

  const isFirstDelivery = await markProcessed(deps.redis, event.eventId, IDEMPOTENCY_TTL_SECONDS);
  if (!isFirstDelivery) {
    deps.logger.info("duplicate event skipped", logFields);
    return;
  }

  const conversation = await Conversation.findById(event.conversationId);
  if (!conversation) {
    deps.logger.warn("conversation not found", logFields);
    return;
  }

  const business = await Business.findById(conversation.businessId);
  if (!business) {
    deps.logger.warn("business not found", logFields);
    return;
  }

  const messages = await Message.find({ conversationId: conversation._id }).sort({ occurredAt: 1 });
  const result = evaluateUnanswered(messages, deps.thresholdMinutes);
  if (!result.isUnanswered) {
    deps.logger.info("no action: conversation is answered", logFields);
    return;
  }

  const existingOpenCase = await RecoveryCase.findOne({
    conversationId: conversation._id,
    type: "unanswered",
    status: "open",
  });

  if (existingOpenCase) {
    existingOpenCase.lastEvaluatedAt = new Date();
    await existingOpenCase.save();
    deps.logger.info("recovery case re-evaluated", {
      ...logFields,
      caseId: String(existingOpenCase._id),
    });
    return;
  }

  const now = new Date();
  const recoveryCase = await RecoveryCase.create({
    businessId: conversation.businessId,
    conversationId: conversation._id,
    customerId: conversation.customerId,
    type: "unanswered",
    status: "open",
    estimatedValue: business.averageTicketValue,
    reason: result.reason,
    detectedAt: now,
    lastEvaluatedAt: now,
  });
  try {
    await deps.invalidateDashboardCache(String(conversation.businessId));
  } catch (err) {
    deps.logger.warn("dashboard cache invalidation failed", {
      ...logFields,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  deps.logger.info("recovery case created", { ...logFields, caseId: String(recoveryCase._id) });
}
