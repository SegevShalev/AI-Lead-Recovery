import { createHash } from "node:crypto";
import type { KnowledgeDocumentType } from "@ai-lead-recovery/shared";

/** Which document (and which version of it) a set of chunks belongs to. */
export interface DocumentRef {
  businessId: string;
  documentId: string;
  version: number;
  type: KnowledgeDocumentType;
  title: string;
}

export interface StoredChunk {
  index: number;
  text: string;
  vector: number[];
}

export interface ChunkHit {
  /** Stable point id - the same (business, document, chunk index) always gets the same id. */
  chunkId: string;
  businessId: string;
  documentId: string;
  version: number;
  type: KnowledgeDocumentType;
  title: string;
  chunkIndex: number;
  text: string;
  /** Cosine similarity to the query, higher is closer. */
  score: number;
}

export interface SearchOptions {
  limit: number;
  /** Hits scoring below this are dropped (tuned on the eval set, Stage 7). */
  minScore: number;
}

/**
 * `applied: false` = the request carried an older version than the one
 * already indexed, so nothing changed (newest version wins, whatever order
 * index calls arrive in). `chunkCount` is what the index now holds for it.
 */
export type ReplaceResult =
  | { applied: true; chunkCount: number }
  | { applied: false; chunkCount: number; storedVersion: number };

/**
 * The AI service's derived knowledge index. Not a source of truth: it can
 * always be rebuilt by re-sending the API's documents.
 *
 * Tenant isolation is part of the signature - `search` cannot be called
 * without a businessId, and implementations must only return that business's
 * chunks.
 */
export interface VectorStore {
  /** Create the collection/indexes if missing. Safe to call on every startup. */
  ensureCollection(): Promise<void>;
  /** Idempotent: same or newer version replaces the document's chunks; older is a no-op. */
  replaceDocument(doc: DocumentRef, chunks: StoredChunk[]): Promise<ReplaceResult>;
  /** Idempotent: deleting a document that was never indexed is not an error. */
  deleteDocument(businessId: string, documentId: string): Promise<void>;
  search(businessId: string, vector: number[], options: SearchOptions): Promise<ChunkHit[]>;
}

/** The store is unreachable or misbehaving. Callers degrade (retrieval) or report 503 (indexing). */
export class VectorStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorStoreError";
  }
}

export function assertBusinessId(businessId: string): void {
  if (businessId.trim() === "") throw new VectorStoreError("businessId is required");
}

// Fixed namespace so the same name always maps to the same UUID (RFC 4122 v5).
const POINT_ID_NAMESPACE = Buffer.from("6f1d3c2a8b7e4f0a9c5d2e1b3a4f6c8d", "hex");

/**
 * Qdrant only accepts unsigned integers or UUIDs as point ids, so the natural
 * key `businessId:documentId:chunkIndex` is turned into a name-based UUID.
 * Deterministic ids are what make re-indexing overwrite instead of duplicate.
 */
export function chunkPointId(businessId: string, documentId: string, chunkIndex: number): string {
  const bytes = createHash("sha1")
    .update(POINT_ID_NAMESPACE)
    // JSON, not "a:b:c", so ids containing ":" can't collide.
    .update(JSON.stringify([businessId, documentId, chunkIndex]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
