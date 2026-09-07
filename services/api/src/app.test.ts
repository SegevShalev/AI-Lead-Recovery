import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { connectMongo, disconnectMongo } from "@ai-lead-recovery/db";
import {
  dashboardCacheKey,
  dashboardCacheVersionKey,
  type ConversationMessageReceivedEvent,
  type SuggestionRequest,
  type SuggestionResponse,
} from "@ai-lead-recovery/shared";
import type { SuggestionClient, SuggestionClientResult } from "./aiServiceClient.js";
import { createApp } from "./app.js";
import {
  Business,
  Conversation,
  Customer,
  Message,
  RecoveryCase,
  Suggestion,
} from "./db/models.js";

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
  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}

class FailingCache {
  async get(): Promise<string | null> {
    throw new Error("connection lost");
  }
  async set(): Promise<string | null> {
    throw new Error("connection lost");
  }
  async del(): Promise<number> {
    throw new Error("connection lost");
  }
}

const okSuggestion: SuggestionResponse = {
  status: "ok",
  message: "היי, רק בודק מה קורה עם ההצעה",
  language: "he",
  reason: "quote sent, no reply",
  model: "mock",
  promptVersion: "hebrew-followup-v1",
  generatedAt: new Date().toISOString(),
};

/** Defaults to a successful mock result; tests that care override `result`. */
class FakeSuggestionClient implements SuggestionClient {
  requests: SuggestionRequest[] = [];
  result: SuggestionClientResult = { ok: true, data: okSuggestion };

  async requestSuggestion(request: SuggestionRequest): Promise<SuggestionClientResult> {
    this.requests.push(request);
    return this.result;
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
      Suggestion.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await disconnectMongo();
  });

  describe("GET /health", () => {
    it("returns ok", async () => {
      const response = await request(
        createApp({
          queue: new FakeQueue(),
          cache: new FakeCache(),
          suggestionClient: new FakeSuggestionClient(),
        }),
      ).get("/health");
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
      const app = createApp({
        queue,
        cache: new FakeCache(),
        suggestionClient: new FakeSuggestionClient(),
      });

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
      const app = createApp({
        queue: new FakeQueue(),
        cache: new FakeCache(),
        suggestionClient: new FakeSuggestionClient(),
      });
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

      const app = createApp({
        queue: new FakeQueue(),
        cache: new FakeCache(),
        suggestionClient: new FakeSuggestionClient(),
      });

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
      const app = createApp({
        queue: new FakeQueue(),
        cache,
        suggestionClient: new FakeSuggestionClient(),
      });

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

    it("ignores a stale write that lands after cache invalidation bumps the version", async () => {
      const business = await Business.create({
        name: "Test Garage",
        vertical: "garage",
        currency: "ILS",
        averageTicketValue: 500,
        settingsVersion: 1,
      });
      const businessId = String(business._id);
      const cache = new FakeCache();
      const app = createApp({
        queue: new FakeQueue(),
        cache,
        suggestionClient: new FakeSuggestionClient(),
      });

      const first = await request(app).get("/api/dashboard").query({ businessId });
      expect(first.body.totalRecoverableValue).toBe(0);

      // Simulate recovery-worker's invalidation (a version bump) racing ahead
      // of a slow request that already read Mongo under the old version and
      // is only now writing its (stale) result back.
      await cache.set(dashboardCacheVersionKey(businessId), "1");
      await cache.set(
        dashboardCacheKey(businessId, "0"),
        JSON.stringify({ totalRecoverableValue: 999, breakdown: {} }),
      );

      const second = await request(app).get("/api/dashboard").query({ businessId });
      expect(second.body.totalRecoverableValue).toBe(0);
    });

    it("falls back to Mongo when the cache is unavailable", async () => {
      const business = await Business.create({
        name: "Test Garage",
        vertical: "garage",
        currency: "ILS",
        averageTicketValue: 500,
        settingsVersion: 1,
      });
      const app = createApp({
        queue: new FakeQueue(),
        cache: new FailingCache(),
        suggestionClient: new FakeSuggestionClient(),
      });

      const response = await request(app)
        .get("/api/dashboard")
        .query({ businessId: String(business._id) });
      expect(response.status).toBe(200);
      expect(response.body.totalRecoverableValue).toBe(0);
    });
  });

  describe("POST /api/recovery-cases/:id/suggestion", () => {
    async function seedCase() {
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
      const recoveryCase = await RecoveryCase.create({
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
      return { business, customer, conversation, recoveryCase };
    }

    it("returns 404 for an unknown recovery case", async () => {
      const app = createApp({
        queue: new FakeQueue(),
        cache: new FakeCache(),
        suggestionClient: new FakeSuggestionClient(),
      });
      const response = await request(app).post(
        "/api/recovery-cases/64b64c1f2f1f2f1f2f1f2f1f/suggestion",
      );
      expect(response.status).toBe(404);
    });

    it("generates and persists a suggestion, and stamps it onto the recovery case", async () => {
      const { recoveryCase } = await seedCase();
      const suggestionClient = new FakeSuggestionClient();
      const app = createApp({
        queue: new FakeQueue(),
        cache: new FakeCache(),
        suggestionClient,
      });

      const response = await request(app).post(
        `/api/recovery-cases/${String(recoveryCase._id)}/suggestion`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: "ok", message: okSuggestion.message });
      expect(typeof response.body.suggestionId).toBe("string");

      const stored = await Suggestion.findById(response.body.suggestionId);
      expect(stored?.message).toBe(okSuggestion.message);
      expect(stored?.reasoningSummary).toBe(okSuggestion.reason);

      const updatedCase = await RecoveryCase.findById(recoveryCase._id);
      expect(updatedCase?.suggestionId).toBe(response.body.suggestionId);
    });

    it("sends only the last outbound message onward, capped at 10, as context", async () => {
      const { conversation, recoveryCase } = await seedCase();
      const base = Date.now();
      // 3 inbound before the business ever replied, then one outbound,
      // then 12 inbound after it — only the outbound + the last 9 of those
      // trailing inbound messages (10 total) should be sent as context.
      for (let i = 0; i < 3; i++) {
        await Message.create({
          conversationId: conversation._id,
          direction: "inbound",
          text: `before-${i}`,
          occurredAt: new Date(base + i * 1000),
        });
      }
      await Message.create({
        conversationId: conversation._id,
        direction: "outbound",
        text: "quoted",
        occurredAt: new Date(base + 3000),
      });
      for (let i = 0; i < 12; i++) {
        await Message.create({
          conversationId: conversation._id,
          direction: "inbound",
          text: `after-${i}`,
          occurredAt: new Date(base + 4000 + i * 1000),
        });
      }

      const suggestionClient = new FakeSuggestionClient();
      const app = createApp({
        queue: new FakeQueue(),
        cache: new FakeCache(),
        suggestionClient,
      });

      await request(app).post(`/api/recovery-cases/${String(recoveryCase._id)}/suggestion`);

      expect(suggestionClient.requests).toHaveLength(1);
      const context = suggestionClient.requests[0]?.conversationContext ?? [];
      expect(context).toHaveLength(10);
      expect(context[0]).toMatchObject({ direction: "outbound", text: "quoted" });
      expect(context.at(-1)).toMatchObject({ direction: "inbound", text: "after-11" });
    });

    it("passes through a degraded ai-service result without persisting anything", async () => {
      const { recoveryCase } = await seedCase();
      const suggestionClient = new FakeSuggestionClient();
      suggestionClient.result = {
        ok: true,
        data: { status: "degraded", errorCode: "provider_error" },
      };
      const app = createApp({
        queue: new FakeQueue(),
        cache: new FakeCache(),
        suggestionClient,
      });

      const response = await request(app).post(
        `/api/recovery-cases/${String(recoveryCase._id)}/suggestion`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "degraded", errorCode: "provider_error" });
      expect(await Suggestion.countDocuments({})).toBe(0);
      const updatedCase = await RecoveryCase.findById(recoveryCase._id);
      expect(updatedCase?.suggestionId).toBeUndefined();
    });

    it("degrades gracefully, without a 500, when the ai service is unreachable", async () => {
      const { recoveryCase } = await seedCase();
      const suggestionClient = new FakeSuggestionClient();
      suggestionClient.result = { ok: false, errorCode: "unreachable" };
      const app = createApp({
        queue: new FakeQueue(),
        cache: new FakeCache(),
        suggestionClient,
      });

      const response = await request(app).post(
        `/api/recovery-cases/${String(recoveryCase._id)}/suggestion`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "degraded", errorCode: "provider_unavailable" });
      expect(await Suggestion.countDocuments({})).toBe(0);
    });
  });
});
