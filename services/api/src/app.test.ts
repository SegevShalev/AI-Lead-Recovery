import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { connectMongo, disconnectMongo } from "@ai-lead-recovery/db";
import type { ConversationMessageReceivedEvent } from "@ai-lead-recovery/shared";
import { createApp } from "./app.js";
import { Business, Conversation, Customer, Message, RecoveryCase } from "./db/models.js";

const MONGODB_URI =
  (process.env.MONGODB_URI ?? "mongodb://localhost:27017/ai-lead-recovery-test") + "-api";

class FakeQueue {
  published: ConversationMessageReceivedEvent[] = [];
  async publish(event: ConversationMessageReceivedEvent): Promise<void> {
    this.published.push(event);
  }
}

class FakeCache {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<string> {
    this.store.set(key, value);
    return "OK";
  }
}

describe("api", () => {
  beforeAll(async () => {
    await connectMongo(MONGODB_URI);
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
    await disconnectMongo();
  });

  describe("GET /health", () => {
    it("returns ok", async () => {
      const response = await request(createApp({ queue: new FakeQueue(), cache: new FakeCache() })).get(
        "/health",
      );
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "ok", service: "api" });
    });
  });

  describe("POST /dev/webhooks/whatsapp", () => {
    it("persists a message and publishes an event", async () => {
      const business = await Business.create({
        name: "Test Garage",
        vertical: "garage",
        currency: "ILS",
        averageTicketValue: 500,
        settingsVersion: 1,
      });
      const queue = new FakeQueue();
      const app = createApp({ queue, cache: new FakeCache() });

      const response = await request(app)
        .post("/dev/webhooks/whatsapp")
        .send({
          businessId: String(business._id),
          customerPhone: "+972501234567",
          customerName: "דני",
          direction: "inbound",
          text: "כמה עולה טיפול?",
        });

      expect(response.status).toBe(201);
      expect(queue.published).toHaveLength(1);
      expect(queue.published[0]?.conversationId).toBe(response.body.conversationId);

      const messageCount = await Message.countDocuments({});
      expect(messageCount).toBe(1);
    });

    it("returns 404 for an unknown business", async () => {
      const app = createApp({ queue: new FakeQueue(), cache: new FakeCache() });
      const response = await request(app).post("/dev/webhooks/whatsapp").send({
        businessId: "64b64c1f2f1f2f1f2f1f2f1f",
        customerPhone: "+972501234567",
        direction: "inbound",
        text: "hello",
      });
      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/dashboard and /api/recovery-cases", () => {
    it("reflects an open recovery case", async () => {
      const business = await Business.create({
        name: "Test Garage",
        vertical: "garage",
        currency: "ILS",
        averageTicketValue: 500,
        settingsVersion: 1,
      });
      const customer = await Customer.create({
        businessId: business._id,
        displayName: "דני",
        phone: "+972501234567",
      });
      const conversation = await Conversation.create({
        businessId: business._id,
        customerId: customer._id,
        channel: "whatsapp",
        status: "open",
        lastMessageAt: new Date(),
      });
      await Message.create({
        conversationId: conversation._id,
        direction: "inbound",
        text: "כמה עולה טיפול?",
        occurredAt: new Date(),
      });
      await RecoveryCase.create({
        businessId: business._id,
        conversationId: conversation._id,
        customerId: customer._id,
        type: "unanswered",
        status: "open",
        estimatedValue: 500,
        reason: "no reply within 60 minutes",
        detectedAt: new Date(),
        lastEvaluatedAt: new Date(),
      });

      const app = createApp({ queue: new FakeQueue(), cache: new FakeCache() });

      const dashboard = await request(app)
        .get("/api/dashboard")
        .query({ businessId: String(business._id) });
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.totalRecoverableValue).toBe(500);
      expect(dashboard.body.breakdown.unanswered).toEqual({ count: 1, estimatedValue: 500 });

      const cases = await request(app)
        .get("/api/recovery-cases")
        .query({ businessId: String(business._id) });
      expect(cases.status).toBe(200);
      expect(cases.body.cases).toHaveLength(1);
      expect(cases.body.cases[0].type).toBe("unanswered");
      expect(cases.body.cases[0].lastMessage.text).toBe("כמה עולה טיפול?");
    });

    it("serves the second read from cache instead of recomputing", async () => {
      const business = await Business.create({
        name: "Test Garage",
        vertical: "garage",
        currency: "ILS",
        averageTicketValue: 500,
        settingsVersion: 1,
      });
      const cache = new FakeCache();
      const app = createApp({ queue: new FakeQueue(), cache });

      const first = await request(app)
        .get("/api/dashboard")
        .query({ businessId: String(business._id) });
      expect(first.body.totalRecoverableValue).toBe(0);

      // A case opens after the first read but before the TTL expires; the
      // cached response should still be served until invalidated.
      const customer = await Customer.create({
        businessId: business._id,
        displayName: "דני",
        phone: "+972501234567",
      });
      const conversation = await Conversation.create({
        businessId: business._id,
        customerId: customer._id,
        channel: "whatsapp",
        status: "open",
        lastMessageAt: new Date(),
      });
      await RecoveryCase.create({
        businessId: business._id,
        conversationId: conversation._id,
        customerId: customer._id,
        type: "unanswered",
        status: "open",
        estimatedValue: 500,
        reason: "no reply within 60 minutes",
        detectedAt: new Date(),
        lastEvaluatedAt: new Date(),
      });

      const second = await request(app)
        .get("/api/dashboard")
        .query({ businessId: String(business._id) });
      expect(second.body.totalRecoverableValue).toBe(0);
    });
  });
});
