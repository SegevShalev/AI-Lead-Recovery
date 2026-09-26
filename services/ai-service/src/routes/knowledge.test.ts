import { indexDocumentResponseSchema, type Logger } from "@ai-lead-recovery/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { type Embedder, EmbeddingError } from "../knowledge/embedder.js";
import { InMemoryVectorStore } from "../knowledge/inMemoryVectorStore.js";
import { KnowledgeIndexer } from "../knowledge/knowledgeIndexer.js";
import { MockEmbedder } from "../knowledge/mockEmbedder.js";
import { type VectorStore, VectorStoreError } from "../knowledge/vectorStore.js";
import { MockSuggestionProvider } from "../providers/mock.js";
import { SuggestionGenerator } from "../suggestionGenerator.js";

const BRAKES_DOC = {
  businessId: "garage-north",
  documentId: "doc-brakes",
  version: 1,
  type: "service",
  title: "החלפת רפידות בלמים",
  content: "החלפת רפידות בלמים קדמיות: 450 ₪ כולל עבודה. זמן עבודה כשעה וחצי.",
  correlationId: "corr-1",
};
const everything = { limit: 100, minScore: -1 };

function recordingLogger(): Logger & { lines: unknown[] } {
  const lines: unknown[] = [];
  const record = (message: string, fields?: object) => lines.push({ message, ...fields });
  return { lines, info: record, warn: record, error: record };
}

function setup(overrides: { embedder?: Embedder; store?: VectorStore } = {}) {
  const store = overrides.store ?? new InMemoryVectorStore();
  const embedder = overrides.embedder ?? new MockEmbedder();
  const logger = recordingLogger();
  const generator = new SuggestionGenerator(new MockSuggestionProvider(), undefined, logger);
  const app = createApp(generator, new KnowledgeIndexer(embedder, store, logger), logger);
  const vectorOf = async (text: string) => (await embedder.embed([text]))[0]!;
  return { app, store, logger, vectorOf };
}

const failingEmbedder = (error: Error): Embedder => ({
  model: "failing",
  dimensions: 4,
  embed: async () => {
    throw error;
  },
});

describe("POST /internal/knowledge/index", () => {
  it("indexes a document and answers per the shared contract", async () => {
    const { app, store, vectorOf } = setup();

    const response = await request(app).post("/internal/knowledge/index").send(BRAKES_DOC);

    expect(response.status).toBe(200);
    expect(indexDocumentResponseSchema.parse(response.body)).toEqual({
      status: "ok",
      chunkCount: 1,
      embeddingModel: "mock-hash-256",
    });
    const hits = await store.search("garage-north", await vectorOf("רפידות בלמים"), everything);
    expect(hits.map((hit) => hit.documentId)).toEqual(["doc-brakes"]);
  });

  it("is idempotent: indexing the same document twice stores it once", async () => {
    const { app, store, vectorOf } = setup();
    const first = await request(app).post("/internal/knowledge/index").send(BRAKES_DOC);
    const second = await request(app).post("/internal/knowledge/index").send(BRAKES_DOC);

    expect(second.body.chunkCount).toBe(first.body.chunkCount);
    const hits = await store.search("garage-north", await vectorOf("בלמים"), everything);
    expect(hits).toHaveLength(first.body.chunkCount);
  });

  it("answers 200 but changes nothing for an older version that arrives late", async () => {
    const { app, store, vectorOf } = setup();
    await request(app)
      .post("/internal/knowledge/index")
      .send({ ...BRAKES_DOC, version: 2 });

    const late = await request(app)
      .post("/internal/knowledge/index")
      .send({ ...BRAKES_DOC, version: 1, content: "מחיר ישן: 300 ₪" });

    expect(late.status).toBe(200);
    expect(late.body).toMatchObject({ status: "ok", chunkCount: 1 });
    const hits = await store.search("garage-north", await vectorOf("בלמים"), everything);
    expect(hits.map((hit) => hit.version)).toEqual([2]);
  });

  it.each([
    ["a missing businessId", { ...BRAKES_DOC, businessId: undefined }],
    ["an unknown type", { ...BRAKES_DOC, type: "price_list" }],
    ["a non-positive version", { ...BRAKES_DOC, version: 0 }],
    ["content over the cap", { ...BRAKES_DOC, content: "א".repeat(20_001) }],
  ])("rejects %s with 400", async (_label, body) => {
    const response = await request(setup().app).post("/internal/knowledge/index").send(body);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
  });

  it("answers 503 when the embedding provider is down, so the API marks it pending", async () => {
    const { app } = setup({
      embedder: failingEmbedder(new EmbeddingError("down", "unavailable", true)),
    });
    const response = await request(app).post("/internal/knowledge/index").send(BRAKES_DOC);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "index_unavailable", code: "unavailable" });
  });

  it("answers 503 when the vector store is down", async () => {
    const store = new InMemoryVectorStore();
    store.replaceDocument = async () => {
      throw new VectorStoreError("qdrant unreachable");
    };
    const response = await request(setup({ store }).app)
      .post("/internal/knowledge/index")
      .send(BRAKES_DOC);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "index_unavailable", code: "vector_store_unavailable" });
  });

  it("answers 422 when the provider rejects the document itself", async () => {
    const { app } = setup({
      embedder: failingEmbedder(new EmbeddingError("too long", "invalid_input", false)),
    });
    const response = await request(app).post("/internal/knowledge/index").send(BRAKES_DOC);
    expect(response.status).toBe(422);
  });

  it("answers 500 instead of hanging on an unexpected error", async () => {
    const { app } = setup({ embedder: failingEmbedder(new Error("bug")) });
    const response = await request(app).post("/internal/knowledge/index").send(BRAKES_DOC);
    expect(response.status).toBe(500);
  });

  it("logs ids and counts, never the document's title or content", async () => {
    const { app, logger } = setup();
    await request(app).post("/internal/knowledge/index").send(BRAKES_DOC);

    expect(logger.lines).toContainEqual(
      expect.objectContaining({
        message: "knowledge indexed",
        correlationId: "corr-1",
        documentId: "doc-brakes",
        chunkCount: 1,
      }),
    );
    const logged = JSON.stringify(logger.lines);
    expect(logged).not.toContain("רפידות");
    expect(logged).not.toContain("450");
  });
});

describe("DELETE /internal/knowledge/:businessId/:documentId", () => {
  it("removes the document and answers 204", async () => {
    const { app, store, vectorOf } = setup();
    await request(app).post("/internal/knowledge/index").send(BRAKES_DOC);

    const response = await request(app).delete("/internal/knowledge/garage-north/doc-brakes");

    expect(response.status).toBe(204);
    expect(await store.search("garage-north", await vectorOf("בלמים"), everything)).toEqual([]);
  });

  it("answers 204 for a document that was never indexed", async () => {
    const response = await request(setup().app).delete("/internal/knowledge/garage-north/nope");
    expect(response.status).toBe(204);
  });

  it("only deletes the given business's copy of a document id", async () => {
    const { app, store, vectorOf } = setup();
    await request(app).post("/internal/knowledge/index").send(BRAKES_DOC);
    await request(app)
      .post("/internal/knowledge/index")
      .send({ ...BRAKES_DOC, businessId: "garage-south" });

    await request(app).delete("/internal/knowledge/garage-north/doc-brakes");

    expect(await store.search("garage-south", await vectorOf("בלמים"), everything)).toHaveLength(1);
  });

  it("answers 503 when the vector store is down, so the API keeps the document", async () => {
    const store = new InMemoryVectorStore();
    store.deleteDocument = async () => {
      throw new VectorStoreError("qdrant unreachable");
    };
    const response = await request(setup({ store }).app).delete(
      "/internal/knowledge/garage-north/doc-brakes",
    );
    expect(response.status).toBe(503);
  });
});
