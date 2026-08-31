import { afterAll, describe, expect, it } from "vitest";
import { createRedisListQueue } from "./redisQueue.js";
import type { ConversationMessageReceivedEvent } from "@ai-lead-recovery/shared";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

function testEvent(eventId: string): ConversationMessageReceivedEvent {
  return {
    eventType: "conversation.message.received",
    eventVersion: 1,
    eventId,
    occurredAt: new Date().toISOString(),
    tenantId: "demo-tenant",
    conversationId: "conversation-1",
    messageId: "message-1",
  };
}

describe("createRedisListQueue", () => {
  const queueName = `test-queue-${crypto.randomUUID()}`;
  const queue = createRedisListQueue(REDIS_URL, queueName);

  afterAll(async () => {
    queue.stop();
    await queue.close();
  });

  it("delivers a published event to a consumer", async () => {
    const received: ConversationMessageReceivedEvent[] = [];
    const consuming = queue.consume(async (event) => {
      received.push(event as ConversationMessageReceivedEvent);
      queue.stop();
    });

    await queue.publish(testEvent("3fa85f64-5717-4562-b3fc-2c963f66afa6"));
    await consuming;

    expect(received).toHaveLength(1);
    expect(received[0]?.conversationId).toBe("conversation-1");
  });
});
