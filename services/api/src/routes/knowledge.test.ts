import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { connectMongo, disconnectMongo } from "@ai-lead-recovery/db";
import {
  businessKnowledgeDocumentSchema,
  type IndexDocumentRequest,
  type SuggestionResponse,
} from "@ai-lead-recovery/shared";
import { createApp } from "../app.js";
import { Business, BusinessKnowledgeDocument } from "../db/models.js";
import type {
  DeleteDocumentResult,
  IndexDocumentResult,
  KnowledgeIndexClient,
} from "../knowledgeIndexClient.js";

const MONGODB_URI =
  (process.env.MONGODB_URI ?? "mongodb://localhost:27018/ai-lead-recovery-test") + "-api-knowledge";

const INDEXED: IndexDocumentResult = {
  ok: true,
  data: { status: "ok", chunkCount: 1, embeddingModel: "mock" },
};
const UNREACHABLE = { ok: false, errorCode: "unreachable" } as const;

class FakeKnowledgeIndexClient implements KnowledgeIndexClient {
  indexed: IndexDocumentRequest[] = [];
  deleted: { businessId: string; documentId: string }[] = [];
  indexResult: IndexDocumentResult = INDEXED;
  deleteResult: DeleteDocumentResult = { ok: true };
  /** Runs while the index call is "in flight" — used to simulate a concurrent edit. */
  duringIndex: (() => Promise<void>) | undefined;

  async indexDocument(req: IndexDocumentRequest): Promise<IndexDocumentResult> {
    this.indexed.push(req);
    await this.duringIndex?.();
    return this.indexResult;
  }

  async deleteDocument(businessId: string, documentId: string): Promise<DeleteDocumentResult> {
    this.deleted.push({ businessId, documentId });
    return this.deleteResult;
  }
}

function buildApp(knowledgeIndexClient: KnowledgeIndexClient) {
  return createApp({
    queue: { publish: async () => {} },
    cache: { get: async () => null, set: async () => "OK", del: async () => 0 },
    suggestionClient: {
      requestSuggestion: async () => ({
        ok: true,
        data: { status: "degraded", errorCode: "provider_error" } satisfies SuggestionResponse,
      }),
    },
    knowledgeIndexClient,
  });
}

const brakes = { type: "service", title: "בלמים", content: "החלפת רפידות: 450 ₪" };

describe("knowledge routes", () => {
  let indexClient: FakeKnowledgeIndexClient;
  let app: ReturnType<typeof buildApp>;
  let garageA: string;
  let garageB: string;

  beforeAll(async () => {
    await connectMongo(MONGODB_URI);
  });

  beforeEach(async () => {
    await Promise.all([Business.deleteMany({}), BusinessKnowledgeDocument.deleteMany({})]);
    const base = { vertical: "garage", currency: "ILS", averageTicketValue: 500 };
    garageA = String((await Business.create({ ...base, name: "A" }))._id);
    garageB = String((await Business.create({ ...base, name: "B" }))._id);
    indexClient = new FakeKnowledgeIndexClient();
    app = buildApp(indexClient);
  });

  afterAll(async () => {
    await Promise.all([Business.deleteMany({}), BusinessKnowledgeDocument.deleteMany({})]);
    await disconnectMongo();
  });

  async function createDoc(businessId = garageA) {
    const res = await request(app).post(`/api/businesses/${businessId}/knowledge`).send(brakes);
    return res.body.document as { _id: string; version: number; indexStatus: string };
  }

  describe("create", () => {
    it("saves version 1, sends it to the index, and marks it indexed", async () => {
      const res = await request(app).post(`/api/businesses/${garageA}/knowledge`).send(brakes);

      expect(res.status).toBe(201);
      const doc = businessKnowledgeDocumentSchema.parse(res.body.document);
      expect(doc).toMatchObject({ ...brakes, businessId: garageA, version: 1 });
      expect(doc.indexStatus).toBe("indexed");
      expect(indexClient.indexed).toEqual([
        expect.objectContaining({
          businessId: garageA,
          documentId: doc._id,
          version: 1,
          content: brakes.content,
        }),
      ]);
    });

    it("still saves the owner's edit, as pending, when the AI service is down", async () => {
      indexClient.indexResult = UNREACHABLE;
      const res = await request(app).post(`/api/businesses/${garageA}/knowledge`).send(brakes);

      expect(res.status).toBe(201);
      expect(res.body.document.indexStatus).toBe("pending");
      expect(await BusinessKnowledgeDocument.countDocuments()).toBe(1);
    });

    it("ignores server-owned fields sent by the client", async () => {
      const res = await request(app)
        .post(`/api/businesses/${garageA}/knowledge`)
        .send({ ...brakes, version: 99, indexStatus: "indexed" });
      expect(res.body.document.version).toBe(1);
    });

    it("rejects invalid input without saving or indexing", async () => {
      const res = await request(app)
        .post(`/api/businesses/${garageA}/knowledge`)
        .send({ ...brakes, title: "  " });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_knowledge_document");
      expect(await BusinessKnowledgeDocument.countDocuments()).toBe(0);
      expect(indexClient.indexed).toHaveLength(0);
    });

    it("404s for a business that doesn't exist", async () => {
      const res = await request(app)
        .post(`/api/businesses/64b64c1f2f1f2f1f2f1f2f1f/knowledge`)
        .send(brakes);
      expect(res.status).toBe(404);
      expect(await BusinessKnowledgeDocument.countDocuments()).toBe(0);
    });
  });

  describe("update", () => {
    it("bumps the version and re-indexes the new content", async () => {
      const created = await createDoc();
      const res = await request(app)
        .put(`/api/businesses/${garageA}/knowledge/${created._id}`)
        .send({ ...brakes, content: "החלפת רפידות: 480 ₪" });

      expect(res.status).toBe(200);
      expect(res.body.document).toMatchObject({ version: 2, indexStatus: "indexed" });
      expect(indexClient.indexed.at(-1)).toMatchObject({
        version: 2,
        content: "החלפת רפידות: 480 ₪",
      });
    });

    it("keeps the new version as pending when the AI service is down", async () => {
      const created = await createDoc();
      indexClient.indexResult = UNREACHABLE;
      const res = await request(app)
        .put(`/api/businesses/${garageA}/knowledge/${created._id}`)
        .send({ ...brakes, content: "החלפת רפידות: 480 ₪" });

      expect(res.body.document).toMatchObject({
        version: 2,
        indexStatus: "pending",
        content: "החלפת רפידות: 480 ₪",
      });
    });

    it("never marks a newer version indexed because an older one was confirmed", async () => {
      const created = await createDoc();
      // While version 2 is being indexed, another edit lands (version 3).
      indexClient.duringIndex = async () => {
        indexClient.duringIndex = undefined;
        await BusinessKnowledgeDocument.updateOne(
          { _id: created._id },
          { $inc: { version: 1 }, indexStatus: "pending" },
        );
      };

      await request(app)
        .put(`/api/businesses/${garageA}/knowledge/${created._id}`)
        .send({ ...brakes, content: "v2" });

      const stored = await BusinessKnowledgeDocument.findById(created._id).lean();
      expect(stored).toMatchObject({ version: 3, indexStatus: "pending" });
    });
  });

  describe("tenant isolation", () => {
    it("never lists, edits, reindexes or deletes another business's document", async () => {
      const aDoc = await createDoc(garageA);
      indexClient.indexed = [];

      const list = await request(app).get(`/api/businesses/${garageB}/knowledge`);
      expect(list.body.documents).toEqual([]);

      const put = await request(app)
        .put(`/api/businesses/${garageB}/knowledge/${aDoc._id}`)
        .send({ ...brakes, content: "hijacked" });
      const reindex = await request(app).post(
        `/api/businesses/${garageB}/knowledge/${aDoc._id}/reindex`,
      );
      const del = await request(app).delete(`/api/businesses/${garageB}/knowledge/${aDoc._id}`);

      expect([put.status, reindex.status, del.status]).toEqual([404, 404, 404]);
      expect(indexClient.indexed).toHaveLength(0);
      expect(indexClient.deleted).toHaveLength(0);
      const stored = await BusinessKnowledgeDocument.findById(aDoc._id).lean();
      expect(stored).toMatchObject({ content: brakes.content, version: 1 });
    });

    it("lists only the requested business's documents", async () => {
      await createDoc(garageA);
      await createDoc(garageB);
      const res = await request(app).get(`/api/businesses/${garageA}/knowledge`);
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.documents[0].businessId).toBe(garageA);
    });
  });

  describe("reindex", () => {
    it("turns a pending document indexed once the AI service is back", async () => {
      indexClient.indexResult = UNREACHABLE;
      const created = await createDoc();
      expect(created.indexStatus).toBe("pending");

      indexClient.indexResult = INDEXED;
      const res = await request(app).post(
        `/api/businesses/${garageA}/knowledge/${created._id}/reindex`,
      );

      expect(res.status).toBe(200);
      expect(res.body.document).toMatchObject({ version: 1, indexStatus: "indexed" });
    });
  });

  describe("delete", () => {
    it("removes from the index, then from Mongo", async () => {
      const created = await createDoc();
      const res = await request(app).delete(`/api/businesses/${garageA}/knowledge/${created._id}`);

      expect(res.status).toBe(204);
      expect(indexClient.deleted).toEqual([{ businessId: garageA, documentId: created._id }]);
      expect(await BusinessKnowledgeDocument.findById(created._id)).toBeNull();
    });

    it("keeps the document when the index can't be reached, so no stale facts stay retrievable", async () => {
      const created = await createDoc();
      indexClient.deleteResult = UNREACHABLE;
      const res = await request(app).delete(`/api/businesses/${garageA}/knowledge/${created._id}`);

      expect(res.status).toBe(503);
      expect(res.body.error).toBe("knowledge_index_unavailable");
      expect(await BusinessKnowledgeDocument.findById(created._id)).not.toBeNull();
    });
  });
});
