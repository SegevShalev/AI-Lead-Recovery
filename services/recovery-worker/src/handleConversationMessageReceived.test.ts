import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectMongo, disconnectMongo } from "@ai-lead-recovery/db";
import { createLogger, type ConversationMessageReceivedEvent } from "@ai-lead-recovery/shared";
import { createClient } from "redis";
import { Business, Conversation, Customer, Message, RecoveryCase } from "./db/models.js";
import { handleConversationMessageReceived, type WorkerDeps } from "./worker.js";

const MONGODB_URI =
  (process.env.MONGODB_URI ?? "mongodb://localhost:27017/ai-lead-recovery-test") +
  "-recovery-worker";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const THRESHOLD_MINUTES = 60;

function eventFor(
  conversationId: string,
  overrides: Partial<ConversationMessageReceivedEvent> = {},
): ConversationMessageReceivedEvent {
  return {
    eventType: "conversation.message.received",
    eventVersion: 1,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    tenantId: "demo-tenant",
    conversationId,
    messageId: "unused-in-this-test",
    ...overrides,
  };
}

describe("handleConversationMessageReceived", () => {
  let redis: ReturnType<typeof createClient>;
  let deps: WorkerDeps;
  let invalidatedBusinessIds: string[];

  beforeAll(async () => {
    await connectMongo(MONGODB_URI);
    redis = createClient({ url: REDIS_URL });
    await redis.connect();
    invalidatedBusinessIds = [];
    deps = {
      redis,
      thresholdMinutes: THRESHOLD_MINUTES,
      logger: createLogger("recovery-worker-test"),
      invalidateDashboardCache: async (businessId) => {
        invalidatedBusinessIds.push(businessId);
      },
    };
  });

  afterEach(async () => {
    invalidatedBusinessIds = [];
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

    await handleConversationMessageReceived(eventFor(String(conversation._id)), deps);

    const cases = await RecoveryCase.find({ conversationId: conversation._id });
    expect(cases).toHaveLength(1);
    expect(cases[0]?.status).toBe("open");
    expect(cases[0]?.estimatedValue).toBe(500);
    expect(invalidatedBusinessIds).toEqual([String(business._id)]);
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
    await handleConversationMessageReceived(event, deps);
    await handleConversationMessageReceived(event, deps);

    const cases = await RecoveryCase.find({ conversationId: conversation._id });
    expect(cases).toHaveLength(1);
    expect(invalidatedBusinessIds).toEqual([String(business._id)]);
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

    await handleConversationMessageReceived(eventFor(String(conversation._id)), deps);

    const cases = await RecoveryCase.find({ conversationId: conversation._id });
    expect(cases).toHaveLength(0);
    expect(invalidatedBusinessIds).toEqual([]);
  });

  it("still creates the case and logs when dashboard cache invalidation fails", async () => {
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

    const warnings: string[] = [];
    const failingDeps: WorkerDeps = {
      ...deps,
      invalidateDashboardCache: async () => {
        throw new Error("redis down");
      },
      logger: {
        ...deps.logger,
        warn: (message) => warnings.push(message),
      },
    };

    await handleConversationMessageReceived(eventFor(String(conversation._id)), failingDeps);

    const cases = await RecoveryCase.find({ conversationId: conversation._id });
    expect(cases).toHaveLength(1);
    expect(warnings).toEqual(["dashboard cache invalidation failed"]);
  });

  it("logs every line for a message under its correlationId", async () => {
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

    const loggedFields: Record<string, unknown>[] = [];
    const spyingDeps: WorkerDeps = {
      ...deps,
      logger: {
        info: (_message, fields) => loggedFields.push(fields ?? {}),
        warn: (_message, fields) => loggedFields.push(fields ?? {}),
        error: (_message, fields) => loggedFields.push(fields ?? {}),
      },
    };

    const event = eventFor(String(conversation._id), { correlationId: "corr-abc" });
    await handleConversationMessageReceived(event, spyingDeps);

    expect(loggedFields.length).toBeGreaterThan(0);
    for (const fields of loggedFields) {
      expect(fields.correlationId).toBe("corr-abc");
    }
  });
});
