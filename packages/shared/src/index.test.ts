import { describe, expect, it } from "vitest";
import { conversationMessageReceivedEventSchema, recoveryCaseSchema } from "./index.js";

describe("shared contracts", () => {
  it("validates a conversation.message.received event", () => {
    const result = conversationMessageReceivedEventSchema.safeParse({
      eventType: "conversation.message.received",
      eventVersion: 1,
      eventId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      occurredAt: new Date().toISOString(),
      tenantId: "demo-tenant",
      conversationId: "conversation-1",
      messageId: "message-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a recovery case with an invalid status", () => {
    const result = recoveryCaseSchema.safeParse({
      _id: "case-1",
      businessId: "business-1",
      conversationId: "conversation-1",
      customerId: "customer-1",
      type: "unanswered",
      status: "not-a-real-status",
      estimatedValue: 300,
      reason: "no reply within window",
      detectedAt: new Date().toISOString(),
      lastEvaluatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});
