import { z } from "zod";
import { messageDirectionSchema } from "./domain.js";

/**
 * Payload for the fake WhatsApp webhook (docs/architecture/service-boundaries.md:
 * `POST /dev/webhooks/whatsapp`). Simulates an inbound/outbound WhatsApp message
 * until real WhatsApp Business Platform integration lands (Phase 8).
 */
export const whatsappWebhookPayloadSchema = z.object({
  businessId: z.string().min(1),
  customerPhone: z.string().min(1),
  customerName: z.string().optional(),
  direction: messageDirectionSchema,
  text: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  externalMessageId: z.string().optional(),
});
export type WhatsappWebhookPayload = z.infer<typeof whatsappWebhookPayloadSchema>;
