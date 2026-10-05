import type { Logger, SuggestionRequest } from "@ai-lead-recovery/shared";
import { describe, expect, it } from "vitest";
import { type Embedder, EmbeddingError } from "./embedder.js";
import { InMemoryVectorStore } from "./inMemoryVectorStore.js";
import { MockEmbedder } from "./mockEmbedder.js";
import { buildRetrievalQuery, KnowledgeRetriever, retrievalContextVersion } from "./retriever.js";
import type { ChunkHit, VectorStore } from "./vectorStore.js";
import { VectorStoreError } from "./vectorStore.js";

const at = (minute: number) => `2026-09-01T10:${String(minute).padStart(2, "0")}:00.000Z`;

function request(
  conversationContext: SuggestionRequest["conversationContext"],
  businessId = "garage-north",
): SuggestionRequest {
  return {
    recoveryCaseId: "case-1",
    businessId,
    caseType: "unanswered",
    reason: "no reply within 60 minutes",
    estimatedValue: 450,
    customer: { displayName: "דנה", phone: "+972500000000" },
    conversationContext,
    correlationId: "corr-1",
  };
}
const inbound = (text: string, minute = 0) => ({
  direction: "inbound" as const,
  text,
  occurredAt: at(minute),
});
const outbound = (text: string, minute = 0) => ({
  direction: "outbound" as const,
  text,
  occurredAt: at(minute),
});

function recordingLogger(): Logger & { lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const record = (message: string, fields?: object) => lines.push({ message, ...fields });
  return { lines, info: record, warn: record, error: record };
}

async function storeWith(...docs: { businessId: string; documentId: string; text: string }[]) {
  const embedder = new MockEmbedder();
  const store = new InMemoryVectorStore();
  for (const doc of docs) {
    const [vector] = await embedder.embed([doc.text]);
    await store.replaceDocument(
      {
        businessId: doc.businessId,
        documentId: doc.documentId,
        version: 1,
        type: "service",
        title: doc.documentId,
      },
      [{ index: 0, text: doc.text, vector: vector! }],
    );
  }
  return { embedder, store };
}

const BRAKES = "החלפת רפידות בלמים\nהחלפת רפידות בלמים קדמיות: 450 ₪ כולל עבודה.";
const HOURS = "שעות פתיחה\nראשון עד חמישי 08:00-17:00. שישי ושבת סגור.";
const BRAKES_QUESTION = "כמה עולה להחליף רפידות בלמים?";

describe("buildRetrievalQuery", () => {
  const conversation = [
    inbound("הודעה 1", 1),
    outbound("תשובה שלנו", 2),
    inbound("הודעה 2", 3),
    inbound("הודעה 3", 4),
    inbound("הודעה 4", 5),
  ];

  it("uses only the latest 3 inbound messages: no case reason, none of ours", () => {
    expect(buildRetrievalQuery(request(conversation))).toBe("הודעה 2\nהודעה 3\nהודעה 4");
  });

  it("prepends the case reason only when asked (the Stage 7 eval comparison)", () => {
    expect(buildRetrievalQuery(request(conversation), { includeReason: true })).toBe(
      "no reply within 60 minutes\nהודעה 2\nהודעה 3\nהודעה 4",
    );
  });

  it("falls back to the latest message when the customer hasn't written (e.g. an unanswered quote)", () => {
    const query = buildRetrievalQuery(request([outbound("הצעת מחיר: רפידות בלמים 450 ₪")]));
    expect(query).toBe("הצעת מחיר: רפידות בלמים 450 ₪");
  });

  it("returns undefined when there is no message text to search with", () => {
    expect(buildRetrievalQuery(request([]))).toBeUndefined();
    expect(buildRetrievalQuery(request([inbound("   ")]))).toBeUndefined();
  });

  it("keeps the newest end of a very long query", () => {
    const query = buildRetrievalQuery(request([inbound(`${"א".repeat(2_000)} סוף`)]))!;
    expect(query.length).toBe(1_000);
    expect(query.endsWith("סוף")).toBe(true);
  });
});

describe("retrievalContextVersion", () => {
  const hit = (documentId: string, version: number, chunkId: string) =>
    ({ documentId, version, chunkId }) as ChunkHit;

  it("is 'none' without hits, and otherwise independent of hit order", () => {
    expect(retrievalContextVersion([])).toBe("none");
    const a = hit("doc-a", 1, "c1");
    const b = hit("doc-b", 2, "c2");
    expect(retrievalContextVersion([a, b])).toBe(retrievalContextVersion([b, a]));
    expect(retrievalContextVersion([a, b])).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when a source document gets a new version", () => {
    expect(retrievalContextVersion([hit("doc-a", 1, "c1")])).not.toBe(
      retrievalContextVersion([hit("doc-a", 2, "c1")]),
    );
  });
});

describe("KnowledgeRetriever", () => {
  const options = { topK: 5, minScore: 0.2 };

  it("reports matching chunks as 'used', best first, with a context version", async () => {
    const { embedder, store } = await storeWith(
      { businessId: "garage-north", documentId: "brakes", text: BRAKES },
      { businessId: "garage-north", documentId: "hours", text: HOURS },
    );
    const retriever = new KnowledgeRetriever(embedder, store, options, recordingLogger());

    const { info, chunks } = await retriever.retrieve(request([inbound(BRAKES_QUESTION)]));

    expect(info.status).toBe("used");
    // The hours chunk scores below minScore, so only brakes comes back.
    expect(info.sources.map((source) => source.documentId)).toEqual(["brakes"]);
    expect(info.sources[0]).toMatchObject({ version: 1, chunkId: chunks[0]!.chunkId });
    expect(info.contextVersion).toBe(retrievalContextVersion(chunks));
  });

  it("only searches the requesting business", async () => {
    const { embedder, store } = await storeWith({
      businessId: "garage-south",
      documentId: "south-brakes",
      text: BRAKES,
    });
    const retriever = new KnowledgeRetriever(embedder, store, options, recordingLogger());

    const { info } = await retriever.retrieve(request([inbound(BRAKES_QUESTION)], "garage-north"));

    expect(info).toEqual({ status: "empty", sources: [], contextVersion: "none" });
  });

  it("caps sources at topK", async () => {
    const docs = Array.from({ length: 4 }, (_, i) => ({
      businessId: "garage-north",
      documentId: `brakes-${i}`,
      text: BRAKES,
    }));
    const { embedder, store } = await storeWith(...docs);
    const retriever = new KnowledgeRetriever(
      embedder,
      store,
      { ...options, topK: 2 },
      recordingLogger(),
    );

    const { info } = await retriever.retrieve(request([inbound(BRAKES_QUESTION)]));
    expect(info.sources).toHaveLength(2);
  });

  it("does not embed anything when there is no query", async () => {
    let embedCalls = 0;
    const embedder: Embedder = {
      model: "counting",
      dimensions: 4,
      embed: async (texts) => {
        embedCalls++;
        return texts.map(() => [1, 0, 0, 0]);
      },
    };
    const retriever = new KnowledgeRetriever(
      embedder,
      new InMemoryVectorStore(),
      options,
      recordingLogger(),
    );

    const { info } = await retriever.retrieve(request([]));
    expect(info.status).toBe("empty");
    expect(embedCalls).toBe(0);
  });

  it.each([
    [
      "the embedding provider",
      "embedding_unavailable",
      new EmbeddingError("down", "unavailable", true),
    ],
    ["the vector store", "vector_store_unavailable", new VectorStoreError("qdrant unreachable")],
    ["a bug", "unexpected_error", new Error("bug")],
  ])("reports 'failed' instead of throwing when %s fails", async (_label, errorCode, error) => {
    const store: VectorStore = new InMemoryVectorStore();
    store.search = async () => {
      throw error;
    };
    const logger = recordingLogger();
    const retriever = new KnowledgeRetriever(new MockEmbedder(), store, options, logger);

    const { info, chunks } = await retriever.retrieve(request([inbound(BRAKES_QUESTION)]));

    expect(info).toEqual({ status: "failed", sources: [], contextVersion: "none" });
    expect(chunks).toEqual([]);
    expect(logger.lines).toContainEqual(
      expect.objectContaining({ message: "knowledge retrieved", status: "failed", errorCode }),
    );
  });

  it("logs ids and scores, never the customer's words or the chunk text", async () => {
    const { embedder, store } = await storeWith({
      businessId: "garage-north",
      documentId: "brakes",
      text: BRAKES,
    });
    const logger = recordingLogger();
    const retriever = new KnowledgeRetriever(embedder, store, options, logger);

    await retriever.retrieve(request([inbound(BRAKES_QUESTION)]));

    expect(logger.lines).toContainEqual(
      expect.objectContaining({
        message: "knowledge retrieved",
        correlationId: "corr-1",
        businessId: "garage-north",
        status: "used",
        chunkIds: [expect.any(String)],
        scores: [expect.any(Number)],
      }),
    );
    const logged = JSON.stringify(logger.lines);
    expect(logged).not.toContain("רפידות");
    expect(logged).not.toContain("כמה עולה");
  });
});
