import { knowledgeDocumentTypeSchema } from "@ai-lead-recovery/shared";
import { z } from "zod";
import {
  assertBusinessId,
  type ChunkHit,
  chunkPointId,
  type DocumentRef,
  type ReplaceResult,
  type SearchOptions,
  type StoredChunk,
  type VectorStore,
  VectorStoreError,
} from "./vectorStore.js";

/**
 * One collection per embedding model: vectors from different models live in
 * different spaces (and sizes), so they must never be compared. Switching
 * EMBEDDING_PROVIDER just points at another collection, which then needs a
 * reindex - it's a derived index, so that's always possible.
 */
export function knowledgeCollectionName(embeddingModel: string): string {
  return `knowledge_chunks__${embeddingModel.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

// Qdrant is outside this process: validate what comes back like any other boundary.
const payloadSchema = z.object({
  businessId: z.string(),
  documentId: z.string(),
  version: z.number().int(),
  type: knowledgeDocumentTypeSchema,
  title: z.string(),
  chunkIndex: z.number().int(),
  text: z.string(),
});
const queryResponseSchema = z.object({
  result: z.object({
    points: z.array(
      z.object({
        id: z.union([z.string(), z.number()]),
        score: z.number(),
        payload: payloadSchema,
      }),
    ),
  }),
});
const scrollResponseSchema = z.object({
  result: z.object({ points: z.array(z.object({ payload: z.object({ version: z.number() }) })) }),
});
const collectionInfoSchema = z.object({
  result: z.object({
    config: z.object({
      params: z.object({ vectors: z.object({ size: z.number(), distance: z.string() }) }),
    }),
  }),
});

/** A document has at most ~50 chunks (20k chars / ~400), so one scroll page covers it. */
const SCROLL_LIMIT = 1_000;
/** Hot path (search, upsert): a user or services/api is waiting on it. */
const DEFAULT_TIMEOUT_MS = 2_000;
/**
 * One-off setup (create collection / payload index with wait=true) is
 * legitimately slow on a busy or cold machine and nobody is waiting on it.
 */
const SETUP_TIMEOUT_MS = 10_000;

export interface QdrantVectorStoreOptions {
  url: string;
  collection: string;
  dimensions: number;
  /** Stored on every point, so a chunk always says which model embedded it. */
  embeddingModel: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Qdrant over its REST API with plain fetch - the same calls as the
 * playground (docs/development/rag-playground.md), now behind VectorStore.
 */
export class QdrantVectorStore implements VectorStore {
  private readonly baseUrl: string;
  private readonly collectionPath: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: QdrantVectorStoreOptions) {
    this.baseUrl = options.url.replace(/\/+$/, "");
    this.collectionPath = `/collections/${encodeURIComponent(options.collection)}`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async ensureCollection(): Promise<void> {
    const { collection, dimensions } = this.options;
    const timeoutMs = SETUP_TIMEOUT_MS;
    const existing = await this.request("GET", this.collectionPath, {
      allowedStatuses: [404],
      timeoutMs,
    });

    if (existing.status === 404) {
      // 409 = another instance created it between our GET and PUT; that's fine.
      await this.request("PUT", this.collectionPath, {
        body: { vectors: { size: dimensions, distance: "Cosine" } },
        allowedStatuses: [409],
        timeoutMs,
      });
    } else {
      const info = collectionInfoSchema.safeParse(existing.body);
      if (!info.success) {
        throw new VectorStoreError(`collection ${collection} has an unexpected vector config`);
      }
      const { size, distance } = info.data.result.config.params.vectors;
      if (size !== dimensions || distance !== "Cosine") {
        throw new VectorStoreError(
          `collection ${collection} has size=${size} distance=${distance}, expected ` +
            `size=${dimensions} distance=Cosine. The embedder changed: delete the collection and reindex.`,
        );
      }
    }

    // Creating an index that already exists is a no-op in Qdrant, so this is safe on every startup.
    // is_tenant tells Qdrant most searches are filtered by businessId, so it lays data out per tenant.
    await this.request("PUT", `${this.collectionPath}/index?wait=true`, {
      body: { field_name: "businessId", field_schema: { type: "keyword", is_tenant: true } },
      timeoutMs,
    });
    await this.request("PUT", `${this.collectionPath}/index?wait=true`, {
      body: { field_name: "documentId", field_schema: "keyword" },
      timeoutMs,
    });
  }

  async replaceDocument(doc: DocumentRef, chunks: StoredChunk[]): Promise<ReplaceResult> {
    assertBusinessId(doc.businessId);
    const stored = await this.storedDocument(doc.businessId, doc.documentId);
    if (stored && doc.version < stored.version) {
      return { applied: false, chunkCount: stored.chunkCount, storedVersion: stored.version };
    }

    // Upsert first, then trim: same (business, document, index) → same point id,
    // so the new chunks overwrite the old ones in place, and only chunks past
    // the new count are left to delete. A search running in between sees the
    // old or the new chunks, never an empty document.
    if (chunks.length > 0) {
      await this.request("PUT", `${this.collectionPath}/points?wait=true`, {
        body: {
          points: chunks.map((chunk) => ({
            id: chunkPointId(doc.businessId, doc.documentId, chunk.index),
            vector: chunk.vector,
            payload: {
              businessId: doc.businessId,
              documentId: doc.documentId,
              version: doc.version,
              type: doc.type,
              title: doc.title,
              chunkIndex: chunk.index,
              text: chunk.text,
              embeddingModel: this.options.embeddingModel,
            },
          })),
        },
      });
    }
    await this.request("POST", `${this.collectionPath}/points/delete?wait=true`, {
      body: {
        filter: {
          must: [
            ...documentConditions(doc.businessId, doc.documentId),
            { key: "chunkIndex", range: { gte: chunks.length } },
          ],
        },
      },
    });
    return { applied: true, chunkCount: chunks.length };
  }

  async deleteDocument(businessId: string, documentId: string): Promise<void> {
    assertBusinessId(businessId);
    // Deleting by a filter that matches nothing is a 200 in Qdrant, so unknown documents are fine.
    await this.request("POST", `${this.collectionPath}/points/delete?wait=true`, {
      body: { filter: { must: documentConditions(businessId, documentId) } },
    });
  }

  async search(businessId: string, vector: number[], options: SearchOptions): Promise<ChunkHit[]> {
    assertBusinessId(businessId);
    const response = await this.request("POST", `${this.collectionPath}/points/query`, {
      body: {
        query: vector,
        filter: { must: [{ key: "businessId", match: { value: businessId } }] },
        limit: options.limit,
        score_threshold: options.minScore,
        with_payload: true,
      },
    });
    const parsed = queryResponseSchema.safeParse(response.body);
    if (!parsed.success) throw new VectorStoreError("qdrant query response failed validation");

    // Defence in depth: the filter above should make this impossible. If it
    // ever happens, fail the retrieval rather than show another garage's data.
    if (parsed.data.result.points.some((point) => point.payload.businessId !== businessId)) {
      throw new VectorStoreError("qdrant returned a chunk from another business");
    }
    return parsed.data.result.points.map((point) => ({
      ...point.payload,
      chunkId: String(point.id),
      score: point.score,
    }));
  }

  private async storedDocument(
    businessId: string,
    documentId: string,
  ): Promise<{ version: number; chunkCount: number } | undefined> {
    const response = await this.request("POST", `${this.collectionPath}/points/scroll`, {
      body: {
        filter: { must: documentConditions(businessId, documentId) },
        limit: SCROLL_LIMIT,
        with_payload: ["version"],
        with_vector: false,
      },
    });
    const parsed = scrollResponseSchema.safeParse(response.body);
    if (!parsed.success) throw new VectorStoreError("qdrant scroll response failed validation");
    const { points } = parsed.data.result;
    if (points.length === 0) return undefined;
    return {
      version: Math.max(...points.map((point) => point.payload.version)),
      chunkCount: points.length,
    };
  }

  /** Any network error, timeout or unexpected status becomes a VectorStoreError. */
  private async request(
    method: string,
    path: string,
    {
      body,
      allowedStatuses = [],
      timeoutMs = this.timeoutMs,
    }: { body?: unknown; allowedStatuses?: number[]; timeoutMs?: number } = {},
  ): Promise<{ status: number; body: unknown }> {
    const init: RequestInit = { method, signal: AbortSignal.timeout(timeoutMs) };
    if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch {
      throw new VectorStoreError(`qdrant ${method} ${path} failed: unreachable or timed out`);
    }
    if (!response.ok && !allowedStatuses.includes(response.status)) {
      throw new VectorStoreError(`qdrant ${method} ${path} returned HTTP ${response.status}`);
    }
    return { status: response.status, body: await response.json().catch(() => null) };
  }
}

function documentConditions(businessId: string, documentId: string) {
  return [
    { key: "businessId", match: { value: businessId } },
    { key: "documentId", match: { value: documentId } },
  ];
}
