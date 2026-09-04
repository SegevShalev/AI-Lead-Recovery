import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  createLogger,
  whatsappWebhookPayloadSchema,
  type ConversationMessageReceivedEvent,
} from "@ai-lead-recovery/shared";
import { Business, Conversation, Customer, Message } from "../db/models.js";

export interface EventPublisher {
  publish(event: ConversationMessageReceivedEvent): Promise<void>;
}

const logger = createLogger("api");

/**
 * Fake WhatsApp ingestion (docs/development/roadmap.md Phase 1).
 * Persists the message, then publishes a versioned event so
 * recovery-worker can evaluate recovery rules asynchronously.
 */
export function createWebhooksRouter(deps: { queue: EventPublisher }): Router {
  const router = Router();

  router.post("/dev/webhooks/whatsapp", async (req, res) => {
    const parsed = whatsappWebhookPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
      return;
    }
    const payload = parsed.data;
    const correlationId = randomUUID();

    const business = await Business.findById(payload.businessId);
    if (!business) {
      logger.warn("webhook rejected: business not found", {
        correlationId,
        businessId: payload.businessId,
      });
      res.status(404).json({ error: "business_not_found" });
      return;
    }

    const occurredAt = payload.occurredAt ? new Date(payload.occurredAt) : new Date();

    const customer = await Customer.findOneAndUpdate(
      { businessId: business._id, phone: payload.customerPhone },
      {
        $setOnInsert: {
          businessId: business._id,
          phone: payload.customerPhone,
          displayName: payload.customerName ?? payload.customerPhone,
        },
      },
      { upsert: true, new: true },
    );

    let conversation = await Conversation.findOne({
      businessId: business._id,
      customerId: customer._id,
      status: "open",
    });
    if (!conversation) {
      conversation = await Conversation.create({
        businessId: business._id,
        customerId: customer._id,
        channel: "whatsapp",
        status: "open",
        lastMessageAt: occurredAt,
      });
    }

    const message = await Message.create({
      conversationId: conversation._id,
      direction: payload.direction,
      text: payload.text,
      occurredAt,
      externalMessageId: payload.externalMessageId,
    });

    conversation.lastMessageAt = occurredAt;
    await conversation.save();

    await deps.queue.publish({
      eventType: "conversation.message.received",
      eventVersion: 1,
      eventId: randomUUID(),
      occurredAt: occurredAt.toISOString(),
      tenantId: String(business._id),
      correlationId,
      conversationId: String(conversation._id),
      messageId: String(message._id),
    });

    logger.info("conversation.message.received published", {
      correlationId,
      conversationId: String(conversation._id),
      messageId: String(message._id),
    });

    res.status(201).json({
      conversationId: String(conversation._id),
      messageId: String(message._id),
    });
  });

  return router;
}
