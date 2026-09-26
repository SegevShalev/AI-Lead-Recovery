import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InMemoryVectorStore } from "./inMemoryVectorStore.js";
import { QdrantVectorStore } from "./qdrantVectorStore.js";
import {
  chunkPointId,
  type DocumentRef,
  type StoredChunk,
  type VectorStore,
  VectorStoreError,
} from "./vectorStore.js";

// Hand-made 4-d vectors: one axis per topic, so expected scores are obvious.
const PRICES = [1, 0, 0, 0];
const HOURS = [0, 1, 0, 0];
const MOSTLY_PRICES = [0.9, 0.1, 0, 0];

const GARAGE_A = "garage-a";
const GARAGE_B = "garage-b";

function doc(businessId: string, documentId: string, version = 1): DocumentRef {
  return { businessId, documentId, version, type: "service", title: `${documentId} v${version}` };
}
function chunks(...vectors: number[][]): StoredChunk[] {
  return vectors.map((vector, index) => ({ index, text: `chunk ${index}`, vector }));
}
const everything = { limit: 100, minScore: -1 };

const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333";
const qdrantReachable = await fetch(`${QDRANT_URL}/readyz`, { signal: AbortSignal.timeout(1_000) })
  .then((response) => response.ok)
  .catch(() => false);
const testCollections: string[] = [];

function newQdrantStore(dimensions = 4, collection = `test_${randomUUID()}`) {
  testCollections.push(collection);
  return new QdrantVectorStore({ url: QDRANT_URL, collection, dimensions, embeddingModel: "test" });
}

afterAll(async () => {
  if (!qdrantReachable) return;
  for (const collection of testCollections) {
    await fetch(`${QDRANT_URL}/collections/${collection}`, { method: "DELETE" });
  }
});

/** The contract every VectorStore must meet - run once per implementation. */
function vectorStoreContract(makeStore: () => VectorStore) {
  let store: VectorStore;
  beforeEach(async () => {
    store = makeStore();
    await store.ensureCollection();
  });

  it("never returns another business's chunks, even identical ones", async () => {
    await store.replaceDocument(doc(GARAGE_A, "brakes"), chunks(PRICES));
    await store.replaceDocument(doc(GARAGE_B, "brakes"), chunks(PRICES));

    const hitsA = await store.search(GARAGE_A, PRICES, everything);
    const hitsB = await store.search(GARAGE_B, PRICES, everything);

    expect(hitsA.map((hit) => hit.businessId)).toEqual([GARAGE_A]);
    expect(hitsB.map((hit) => hit.businessId)).toEqual([GARAGE_B]);
  });

  it("returns hits best-first, with payload, capped by limit and minScore", async () => {
    await store.replaceDocument(doc(GARAGE_A, "prices"), chunks(PRICES));
    await store.replaceDocument(doc(GARAGE_A, "mixed"), chunks(MOSTLY_PRICES));
    await store.replaceDocument(doc(GARAGE_A, "hours"), chunks(HOURS));

    const all = await store.search(GARAGE_A, PRICES, everything);
    expect(all.map((hit) => hit.documentId)).toEqual(["prices", "mixed", "hours"]);
    expect(all[0]).toMatchObject({
      chunkId: chunkPointId(GARAGE_A, "prices", 0),
      businessId: GARAGE_A,
      documentId: "prices",
      version: 1,
      type: "service",
      title: "prices v1",
      chunkIndex: 0,
      text: "chunk 0",
    });
    expect(all[0]!.score).toBeCloseTo(1, 5);

    expect(await store.search(GARAGE_A, PRICES, { limit: 1, minScore: -1 })).toHaveLength(1);
    const aboveHalf = await store.search(GARAGE_A, PRICES, { limit: 10, minScore: 0.5 });
    expect(aboveHalf.map((hit) => hit.documentId)).toEqual(["prices", "mixed"]);
  });

  it("re-indexing the same version replaces chunks instead of duplicating them", async () => {
    await store.replaceDocument(doc(GARAGE_A, "brakes"), chunks(PRICES, HOURS));
    const again = await store.replaceDocument(doc(GARAGE_A, "brakes"), chunks(PRICES, HOURS));

    expect(again).toEqual({ applied: true, chunkCount: 2 });
    expect(await store.search(GARAGE_A, PRICES, everything)).toHaveLength(2);
  });

  it("a newer version with fewer chunks leaves no stale chunks behind", async () => {
    await store.replaceDocument(doc(GARAGE_A, "brakes", 1), chunks(PRICES, HOURS, HOURS));
    await store.replaceDocument(doc(GARAGE_A, "brakes", 2), chunks(PRICES));

    const hits = await store.search(GARAGE_A, PRICES, everything);
    expect(hits.map((hit) => [hit.chunkIndex, hit.version])).toEqual([[0, 2]]);
  });

  it("ignores an older version that arrives late", async () => {
    await store.replaceDocument(doc(GARAGE_A, "brakes", 3), chunks(PRICES));
    const late = await store.replaceDocument(doc(GARAGE_A, "brakes", 2), chunks(HOURS, HOURS));

    expect(late).toEqual({ applied: false, chunkCount: 1, storedVersion: 3 });
    const hits = await store.search(GARAGE_A, PRICES, everything);
    expect(hits.map((hit) => hit.version)).toEqual([3]);
  });

  it("deletes only the given business's document", async () => {
    await store.replaceDocument(doc(GARAGE_A, "brakes"), chunks(PRICES));
    await store.replaceDocument(doc(GARAGE_A, "hours"), chunks(HOURS));
    await store.replaceDocument(doc(GARAGE_B, "brakes"), chunks(PRICES));

    await store.deleteDocument(GARAGE_A, "brakes");

    expect((await store.search(GARAGE_A, PRICES, everything)).map((hit) => hit.documentId)).toEqual(
      ["hours"],
    );
    expect(await store.search(GARAGE_B, PRICES, everything)).toHaveLength(1);
  });

  it("treats deleting an unknown document as success", async () => {
    await expect(store.deleteDocument(GARAGE_A, "never-indexed")).resolves.toBeUndefined();
  });

  it("refuses to search without a businessId", async () => {
    await expect(store.search("", PRICES, everything)).rejects.toBeInstanceOf(VectorStoreError);
  });
}

describe("InMemoryVectorStore", () => {
  vectorStoreContract(() => new InMemoryVectorStore());
});

describe.skipIf(!qdrantReachable)("QdrantVectorStore (live, needs docker compose qdrant)", () => {
  vectorStoreContract(() => newQdrantStore());

  it("ensureCollection is safe to call repeatedly", async () => {
    const store = newQdrantStore();
    await store.ensureCollection();
    await expect(store.ensureCollection()).resolves.toBeUndefined();
  });

  it("fails loudly when the collection was made for different dimensions", async () => {
    const collection = `test_${randomUUID()}`;
    await newQdrantStore(4, collection).ensureCollection();
    await expect(newQdrantStore(5, collection).ensureCollection()).rejects.toThrow(
      /embedder changed/,
    );
  });
});

describe("QdrantVectorStore (stubbed fetch)", () => {
  const storeWith = (fetchImpl: typeof fetch) =>
    new QdrantVectorStore({
      url: "http://qdrant.invalid",
      collection: "c",
      dimensions: 4,
      embeddingModel: "test",
      fetchImpl,
    });

  it("turns a network failure into a VectorStoreError", async () => {
    const store = storeWith(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(store.search(GARAGE_A, PRICES, everything)).rejects.toBeInstanceOf(
      VectorStoreError,
    );
  });

  it("fails the search if the store ever returns another business's chunk", async () => {
    const store = storeWith(
      async () =>
        new Response(
          JSON.stringify({
            result: {
              points: [
                {
                  id: "p1",
                  score: 0.9,
                  payload: { ...doc(GARAGE_B, "brakes"), chunkIndex: 0, text: "800 ₪" },
                },
              ],
            },
          }),
        ),
    );
    await expect(store.search(GARAGE_A, PRICES, everything)).rejects.toThrow(/another business/);
  });
});

describe("chunkPointId", () => {
  it("is a stable v5 UUID that differs per business, document and chunk", () => {
    const id = chunkPointId(GARAGE_A, "brakes", 0);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(chunkPointId(GARAGE_A, "brakes", 0)).toBe(id);
    expect(
      new Set([
        id,
        chunkPointId(GARAGE_B, "brakes", 0),
        chunkPointId(GARAGE_A, "hours", 0),
        chunkPointId(GARAGE_A, "brakes", 1),
      ]).size,
    ).toBe(4);
  });
});
