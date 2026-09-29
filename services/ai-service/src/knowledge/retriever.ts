import { createHash } from "node:crypto";
import {
  type Logger,
  NO_RETRIEVAL_CONTEXT_VERSION,
  type RetrievalInfo,
  type SuggestionRequest,
} from "@ai-lead-recovery/shared";
import { type Embedder, EmbeddingError } from "./embedder.js";
import { type ChunkHit, type VectorStore, VectorStoreError } from "./vectorStore.js";

/** How many of the latest inbound messages go into the query. */
const QUERY_INBOUND_MESSAGES = 3;
/** Keeps the query well inside any embedding input limit; the newest text is kept. */
const QUERY_MAX_CHARS = 1_000;

export interface RetrievalOutcome {
  /** Returned to services/api as-is (`retrieval` in the suggestion result). */
  info: RetrievalInfo;
  /** The hits themselves - used by the prompt from Stage 8 on. Never logged. */
  chunks: ChunkHit[];
}

export interface Retriever {
  /** Never throws: any failure is reported as `info.status: "failed"`. */
  retrieve(request: SuggestionRequest): Promise<RetrievalOutcome>;
}

export interface RetrievalOptions {
  topK: number;
  minScore: number;
}

/**
 * What we search with (checklist: "latest inbound messages + case reason").
 * If the customer hasn't written since our last message (e.g. a quote went
 * unanswered), the latest message of either side is used instead - our own
 * quote usually names the service. Returns undefined when there is nothing
 * to search with. Kept separate so Stage 7 can compare query variants.
 */
export function buildRetrievalQuery(request: SuggestionRequest): string | undefined {
  const messages = request.conversationContext.filter((message) => message.text.trim() !== "");
  const inbound = messages.filter((message) => message.direction === "inbound");
  const picked = inbound.length > 0 ? inbound.slice(-QUERY_INBOUND_MESSAGES) : messages.slice(-1);
  if (picked.length === 0) return undefined;

  const query = [request.reason, ...picked.map((message) => message.text)]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n");
  return query.length > QUERY_MAX_CHARS ? query.slice(-QUERY_MAX_CHARS) : query;
}

/**
 * Stable id of "what knowledge this suggestion saw" → Suggestion.retrievalContextVersion.
 * Order-independent, and it changes whenever a source document gets a new version.
 */
export function retrievalContextVersion(hits: readonly ChunkHit[]): string {
  if (hits.length === 0) return NO_RETRIEVAL_CONTEXT_VERSION;
  const keys = hits.map((hit) => `${hit.documentId}:${hit.version}:${hit.chunkId}`).sort();
  return createHash("sha256").update(keys.join("\n")).digest("hex").slice(0, 16);
}

/** The retrieval half of RAG: query → embed → tenant-filtered top-k search. */
export class KnowledgeRetriever implements Retriever {
  constructor(
    private readonly embedder: Embedder,
    private readonly store: VectorStore,
    private readonly options: RetrievalOptions,
    private readonly logger: Logger,
  ) {}

  async retrieve(request: SuggestionRequest): Promise<RetrievalOutcome> {
    const startedAt = Date.now();
    const trace = { correlationId: request.correlationId, businessId: request.businessId };

    const query = buildRetrievalQuery(request);
    if (query === undefined) {
      this.logger.info("knowledge retrieved", { ...trace, status: "empty", reason: "no_query" });
      return { info: emptyInfo("empty"), chunks: [] };
    }

    let chunks: ChunkHit[];
    try {
      const [vector] = await this.embedder.embed([query]);
      chunks = await this.store.search(request.businessId, vector!, {
        limit: this.options.topK,
        minScore: this.options.minScore,
      });
    } catch (error) {
      // Degrade rule: generation continues without knowledge.
      this.logger.warn("knowledge retrieved", {
        ...trace,
        status: "failed",
        errorCode: retrievalErrorCode(error),
        latencyMs: Date.now() - startedAt,
      });
      return { info: emptyInfo("failed"), chunks: [] };
    }

    const status = chunks.length > 0 ? "used" : "empty";
    // Ids and scores only - never the query or chunk text (customer content).
    this.logger.info("knowledge retrieved", {
      ...trace,
      status,
      chunkIds: chunks.map((hit) => hit.chunkId),
      scores: chunks.map((hit) => Number(hit.score.toFixed(4))),
      latencyMs: Date.now() - startedAt,
    });
    return {
      info: {
        status,
        sources: chunks.map((hit) => ({
          documentId: hit.documentId,
          version: hit.version,
          chunkId: hit.chunkId,
          score: hit.score,
        })),
        contextVersion: retrievalContextVersion(chunks),
      },
      chunks,
    };
  }
}

function retrievalErrorCode(error: unknown): string {
  if (error instanceof EmbeddingError) return `embedding_${error.code}`;
  if (error instanceof VectorStoreError) return "vector_store_unavailable";
  return "unexpected_error";
}

function emptyInfo(status: "empty" | "failed"): RetrievalInfo {
  return { status, sources: [], contextVersion: NO_RETRIEVAL_CONTEXT_VERSION };
}
