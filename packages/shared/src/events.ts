import { z } from "zod";

export const eventEnvelopeSchema = z.object({
  eventType: z.string(),
  eventVersion: z.number().int().positive(),
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  tenantId: z.string(),
  correlationId: z.string().optional(),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export const conversationMessageReceivedEventSchema = eventEnvelopeSchema.extend({
  eventType: z.literal("conversation.message.received"),
  eventVersion: z.literal(1),
  conversationId: z.string(),
  messageId: z.string(),
});
export type ConversationMessageReceivedEvent = z.infer<
  typeof conversationMessageReceivedEventSchema
>;
