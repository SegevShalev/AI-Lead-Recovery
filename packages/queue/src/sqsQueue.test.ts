import { mockClient } from "aws-sdk-client-mock";
import {
  SQSClient,
  ReceiveMessageCommand,
  SendMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { beforeEach, describe, expect, it } from "vitest";
import { createSqsQueue } from "./sqsQueue.js";
import type { ConversationMessageReceivedEvent } from "@ai-lead-recovery/shared";

const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/000000000000/test-queue";
const sqsMock = mockClient(SQSClient);

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

beforeEach(() => {
  sqsMock.reset();
});

describe("createSqsQueue", () => {
  it("publishes an event as the message body", async () => {
    sqsMock.on(SendMessageCommand).resolves({ MessageId: "sent-1" });
    const queue = createSqsQueue(QUEUE_URL, "us-east-1");

    await queue.publish(testEvent("3fa85f64-5717-4562-b3fc-2c963f66afa6"));

    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0].input.QueueUrl).toBe(QUEUE_URL);
    expect(JSON.parse(String(calls[0]?.args[0].input.MessageBody))).toMatchObject({
      eventId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    });
  });

  it("delivers a received message to the handler and deletes it on success", async () => {
    const event = testEvent("3fa85f64-5717-4562-b3fc-2c963f66afa6");
    sqsMock.on(ReceiveMessageCommand).resolves({
      Messages: [{ Body: JSON.stringify(event), ReceiptHandle: "receipt-1" }],
    });
    const queue = createSqsQueue(QUEUE_URL, "us-east-1");

    const received: ConversationMessageReceivedEvent[] = [];
    await queue.consume(async (e) => {
      received.push(e as ConversationMessageReceivedEvent);
      queue.stop();
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.conversationId).toBe("conversation-1");
    const deleteCalls = sqsMock.commandCalls(DeleteMessageCommand);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.args[0].input.ReceiptHandle).toBe("receipt-1");
  });

  it("does not delete the message when the handler throws, so SQS can redeliver it", async () => {
    const event = testEvent("3fa85f64-5717-4562-b3fc-2c963f66afa6");
    sqsMock.on(ReceiveMessageCommand).resolves({
      Messages: [{ Body: JSON.stringify(event), ReceiptHandle: "receipt-2" }],
    });
    const queue = createSqsQueue(QUEUE_URL, "us-east-1");

    await queue.consume(async () => {
      queue.stop();
      throw new Error("handler boom");
    });

    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
  });

  it("logs and skips a malformed message body instead of crashing the consume loop", async () => {
    const event = testEvent("3fa85f64-5717-4562-b3fc-2c963f66afa6");
    sqsMock.on(ReceiveMessageCommand).resolves({
      Messages: [
        { Body: "not valid json", ReceiptHandle: "receipt-bad" },
        { Body: JSON.stringify(event), ReceiptHandle: "receipt-good" },
      ],
    });
    const queue = createSqsQueue(QUEUE_URL, "us-east-1");

    const received: ConversationMessageReceivedEvent[] = [];
    await queue.consume(async (e) => {
      received.push(e as ConversationMessageReceivedEvent);
      queue.stop();
    });

    expect(received).toHaveLength(1);
    const deleteCalls = sqsMock.commandCalls(DeleteMessageCommand);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.args[0].input.ReceiptHandle).toBe("receipt-good");
  });

  it("polls again when a receive returns no messages", async () => {
    const event = testEvent("3fa85f64-5717-4562-b3fc-2c963f66afa6");
    sqsMock
      .on(ReceiveMessageCommand)
      .resolvesOnce({ Messages: [] })
      .resolvesOnce({ Messages: [{ Body: JSON.stringify(event), ReceiptHandle: "receipt-3" }] });
    const queue = createSqsQueue(QUEUE_URL, "us-east-1");

    const received: ConversationMessageReceivedEvent[] = [];
    await queue.consume(async (e) => {
      received.push(e as ConversationMessageReceivedEvent);
      queue.stop();
    });

    expect(received).toHaveLength(1);
    expect(sqsMock.commandCalls(ReceiveMessageCommand)).toHaveLength(2);
  });
});
