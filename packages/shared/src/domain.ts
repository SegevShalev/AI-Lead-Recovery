import { z } from "zod";

export const channelSchema = z.literal("whatsapp");
export type Channel = z.infer<typeof channelSchema>;

export const businessSchema = z.object({
  _id: z.string(),
  name: z.string(),
  vertical: z.string(),
  currency: z.literal("ILS"),
  averageTicketValue: z.number().nonnegative(),
  settingsVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Business = z.infer<typeof businessSchema>;

export const customerSchema = z.object({
  _id: z.string(),
  businessId: z.string(),
  displayName: z.string(),
  phone: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Customer = z.infer<typeof customerSchema>;

export const conversationStatusSchema = z.enum(["open", "closed"]);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const conversationSchema = z.object({
  _id: z.string(),
  businessId: z.string(),
  customerId: z.string(),
  channel: channelSchema,
  status: conversationStatusSchema,
  lastMessageAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const messageDirectionSchema = z.enum(["inbound", "outbound"]);
export type MessageDirection = z.infer<typeof messageDirectionSchema>;

export const messageSchema = z.object({
  _id: z.string(),
  conversationId: z.string(),
  direction: messageDirectionSchema,
  text: z.string(),
  occurredAt: z.string().datetime(),
  externalMessageId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type Message = z.infer<typeof messageSchema>;

export const recoveryCaseTypeSchema = z.enum([
  "unanswered",
  "quote_no_response",
  "appointment_no_confirmation",
  "dormant_customer",
]);
export type RecoveryCaseType = z.infer<typeof recoveryCaseTypeSchema>;

export const recoveryCaseStatusSchema = z.enum([
  "open",
  "handled",
  "won",
  "lost",
  "no_response",
]);
export type RecoveryCaseStatus = z.infer<typeof recoveryCaseStatusSchema>;

export const recoveryCaseSchema = z.object({
  _id: z.string(),
  businessId: z.string(),
  conversationId: z.string(),
  customerId: z.string(),
  type: recoveryCaseTypeSchema,
  status: recoveryCaseStatusSchema,
  estimatedValue: z.number().nonnegative(),
  reason: z.string(),
  detectedAt: z.string().datetime(),
  lastEvaluatedAt: z.string().datetime(),
  suggestionId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RecoveryCase = z.infer<typeof recoveryCaseSchema>;
