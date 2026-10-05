import type { IndexDocumentRequest, IndexDocumentResponse, Logger } from "@ai-lead-recovery/shared";
import { chunkDocument } from "./chunker.js";
import type { Embedder } from "./embedder.js";
import type { VectorStore } from "./vectorStore.js";

/**
 * The ingestion half of RAG: chunk → embed → store. Called synchronously by
 * services/api on every knowledge document write (checklist decision 2).
 * Errors (EmbeddingError, VectorStoreError) propagate; the route maps them.
 */
export class KnowledgeIndexer {
  constructor(
    private readonly embedder: Embedder,
    private readonly store: VectorStore,
    private readonly logger: Logger,
  ) {}

  async index(request: IndexDocumentRequest): Promise<IndexDocumentResponse> {
    const startedAt = Date.now();
    const chunks = chunkDocument(request);
    const vectors = await this.embedder.embed(chunks.map((chunk) => chunk.text));

    const result = await this.store.replaceDocument(
      {
        businessId: request.businessId,
        documentId: request.documentId,
        version: request.version,
        type: request.type,
        title: request.title,
      },
      chunks.map((chunk, i) => ({ index: chunk.index, text: chunk.text, vector: vectors[i]! })),
    );

    // Ids and counts only - never the document's title or text.
    this.logger.info("knowledge indexed", {
      correlationId: request.correlationId,
      businessId: request.businessId,
      documentId: request.documentId,
      version: request.version,
      applied: result.applied,
      ...(result.applied ? {} : { storedVersion: result.storedVersion }),
      chunkCount: result.chunkCount,
      embeddingModel: this.embedder.model,
      latencyMs: Date.now() - startedAt,
    });
    return { status: "ok", chunkCount: result.chunkCount, embeddingModel: this.embedder.model };
  }

  async delete(businessId: string, documentId: string, correlationId?: string): Promise<void> {
    await this.store.deleteDocument(businessId, documentId);
    this.logger.info("knowledge deleted", { correlationId, businessId, documentId });
  }
}
