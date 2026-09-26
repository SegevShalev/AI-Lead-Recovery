import { cosineSimilarity } from "./similarity.js";
import {
  assertBusinessId,
  type ChunkHit,
  chunkPointId,
  type DocumentRef,
  type ReplaceResult,
  type SearchOptions,
  type StoredChunk,
  type VectorStore,
} from "./vectorStore.js";

type Point = Omit<ChunkHit, "score"> & { vector: number[] };

/**
 * Exact (brute-force) search over a Map. Same contract as QdrantVectorStore -
 * both run the same test suite - so route/retriever tests don't need Docker.
 */
export class InMemoryVectorStore implements VectorStore {
  private readonly points = new Map<string, Point>();

  async ensureCollection(): Promise<void> {}

  async replaceDocument(doc: DocumentRef, chunks: StoredChunk[]): Promise<ReplaceResult> {
    assertBusinessId(doc.businessId);
    const existing = this.documentPoints(doc.businessId, doc.documentId);
    const storedVersion = Math.max(0, ...existing.map((point) => point.version));
    if (existing.length > 0 && doc.version < storedVersion) {
      return { applied: false, chunkCount: existing.length, storedVersion };
    }

    for (const point of existing) this.points.delete(point.chunkId);
    for (const chunk of chunks) {
      const chunkId = chunkPointId(doc.businessId, doc.documentId, chunk.index);
      this.points.set(chunkId, {
        ...doc,
        chunkId,
        chunkIndex: chunk.index,
        text: chunk.text,
        vector: chunk.vector,
      });
    }
    return { applied: true, chunkCount: chunks.length };
  }

  async deleteDocument(businessId: string, documentId: string): Promise<void> {
    assertBusinessId(businessId);
    for (const point of this.documentPoints(businessId, documentId))
      this.points.delete(point.chunkId);
  }

  async search(businessId: string, vector: number[], options: SearchOptions): Promise<ChunkHit[]> {
    assertBusinessId(businessId);
    return [...this.points.values()]
      .filter((point) => point.businessId === businessId)
      .map(({ vector: pointVector, ...hit }) => ({
        ...hit,
        score: cosineSimilarity(vector, pointVector),
      }))
      .filter((hit) => hit.score >= options.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit);
  }

  private documentPoints(businessId: string, documentId: string): Point[] {
    return [...this.points.values()].filter(
      (point) => point.businessId === businessId && point.documentId === documentId,
    );
  }
}
