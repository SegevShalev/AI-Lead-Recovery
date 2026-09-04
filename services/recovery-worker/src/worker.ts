import type { Env } from "@ai-lead-recovery/config";
import { markProcessed, unmarkProcessed, type RedisSetClient } from "@ai-lead-recovery/queue";
import type { ConversationMessageReceivedEvent } from "@ai-lead-recovery/shared";
import { Business, Conversation, Message, RecoveryCase } from "./db/models.js";
import { evaluateUnanswered } from "./rules/unanswered.js";

export function describeStartup(env: Env): string {
  return `[recovery-worker] starting (env=${env.NODE_ENV}, queueProvider=${env.QUEUE_PROVIDER})`;
}

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export interface WorkerDeps {
  redis: RedisSetClient;
  thresholdMinutes: number;
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
  const isFirstDelivery = await markProcessed(deps.redis, event.eventId, IDEMPOTENCY_TTL_SECONDS);
  if (!isFirstDelivery) return;

  try {
    const conversation = await Conversation.findById(event.conversationId);
    if (!conversation) return;

    const business = await Business.findById(conversation.businessId);
    if (!business) return;

    const messages = await Message.find({ conversationId: conversation._id }).sort({
      occurredAt: 1,
    });
    const result = evaluateUnanswered(messages, deps.thresholdMinutes);
    if (!result.isUnanswered) return;

    const existingOpenCase = await RecoveryCase.findOne({
      conversationId: conversation._id,
      type: "unanswered",
      status: "open",
    });

    if (existingOpenCase) {
      existingOpenCase.lastEvaluatedAt = new Date();
      await existingOpenCase.save();
      return;
    }

    const now = new Date();
    await RecoveryCase.create({
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
  } catch (error) {
    // The claim above already marked this eventId processed; without rolling
    // it back, SQS's redelivery-on-error would find it "already processed"
    // and skip the retry silently instead of actually reprocessing it.
    await unmarkProcessed(deps.redis, event.eventId);
    throw error;
  }
}
