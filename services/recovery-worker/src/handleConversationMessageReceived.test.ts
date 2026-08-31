import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectMongo, disconnectMongo } from "@ai-lead-recovery/db";
import type { ConversationMessageReceivedEvent } from "@ai-lead-recovery/shared";
import { createClient } from "redis";
import { Business, Conversation, Customer, Message, RecoveryCase } from "./db/models.js";
import { handleConversationMessageReceived } from "./worker.js";

const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017/ai-lead-recovery-test";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const THRESHOLD_MINUTES = 60;

function eventFor(conversationId: string): ConversationMessageReceivedEvent {
  return {
    eventType: "conversation.message.received",
    eventVersion: 1,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    tenantId: "demo-tenant",
    conversationId,
    messageId: "unused-in-this-test",
  };
}

describe("handleConversationMessageReceived", () => {
  let redis: ReturnType<typeof createClient>;

  beforeAll(async () => {
    await connectMongo(MONGODB_URI);
    redis = createClient({ url: REDIS_URL });
    await redis.connect();
  });

  afterEach(async () => {
    await Promise.all([
      Business.deleteMany({}),
      Customer.deleteMany({}),
      Conversation.deleteMany({}),
      Message.deleteMany({}),
      RecoveryCase.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await redis.quit();
    await disconnectMongo();
  });

  it("creates an open unanswered recovery case for a stale inbound message", async () => {
    const business = await Business.create({ averageTicketValue: 500 });
    const customer = await Customer.create({
      businessId: business._id,
      displayName: "דני",
      phone: "+972501234567",
    });
    const conversation = await Conversation.create({
      businessId: business._id,
      customerId: customer._id,
    });
    await Message.create({
      conversationId: conversation._id,
      direction: "inbound",
      occurredAt: new Date(Date.now() - 2 * 60 * 60_000),
    });

    await handleConversationMessageReceived(eventFor(String(conversation._id)), {
      redis,
      thresholdMinutes: THRESHOLD_MINUTES,
    });

    const cases = await RecoveryCase.find({ conversationId: conversation._id });
    expect(cases).toHaveLength(1);
    expect(cases[0]?.status).toBe("open");
    expect(cases[0]?.estimatedValue).toBe(500);
  });

  it("is idempotent for duplicate event delivery", async () => {
    const business = await Business.create({ averageTicketValue: 500 });
    const customer = await Customer.create({
      businessId: business._id,
      displayName: "דני",
      phone: "+972501234567",
    });
    const conversation = await Conversation.create({
      businessId: business._id,
      customerId: customer._id,
    });
    await Message.create({
      conversationId: conversation._id,
      direction: "inbound",
      occurredAt: new Date(Date.now() - 2 * 60 * 60_000),
    });

    const event = eventFor(String(conversation._id));
    await handleConversationMessageReceived(event, { redis, thresholdMinutes: THRESHOLD_MINUTES });
    await handleConversationMessageReceived(event, { redis, thresholdMinutes: THRESHOLD_MINUTES });

    const cases = await RecoveryCase.find({ conversationId: conversation._id });
    expect(cases).toHaveLength(1);
  });

  it("does not create a case when the last message already has a reply", async () => {
    const business = await Business.create({ averageTicketValue: 500 });
    const customer = await Customer.create({
      businessId: business._id,
      displayName: "דני",
      phone: "+972501234567",
    });
    const conversation = await Conversation.create({
      businessId: business._id,
      customerId: customer._id,
    });
    await Message.create({
      conversationId: conversation._id,
      direction: "inbound",
      occurredAt: new Date(Date.now() - 2 * 60 * 60_000),
    });
    await Message.create({
      conversationId: conversation._id,
      direction: "outbound",
      occurredAt: new Date(Date.now() - 90 * 60_000),
    });

    await handleConversationMessageReceived(eventFor(String(conversation._id)), {
      redis,
      thresholdMinutes: THRESHOLD_MINUTES,
    });

    const cases = await RecoveryCase.find({ conversationId: conversation._id });
    expect(cases).toHaveLength(0);
  });
});
