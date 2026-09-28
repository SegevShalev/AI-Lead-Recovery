import { z } from "zod";

/**
 * Contract between services/api (owns BusinessKnowledgeDocument, the source
 * of truth) and services/ai-service (owns the derived chunk/embedding index).
 * See docs/development/phase-4-checklist.md "Contract additions".
 */
export const knowledgeDocumentTypeSchema = z.enum([
  "service",
  "policy",
  "faq",
  "style",
  "example",
  "other",
]);
export type KnowledgeDocumentType = z.infer<typeof knowledgeDocumentTypeSchema>;

/** Content cap, shared by the owner-facing input and the index contract. */
export const KNOWLEDGE_CONTENT_MAX_LENGTH = 20_000;

/**
 * "pending" = saved in the API but the AI service couldn't be reached to
 * index it; a reindex retries. The owner's edit is never lost.
 */
export const knowledgeIndexStatusSchema = z.enum(["indexed", "pending"]);
export type KnowledgeIndexStatus = z.infer<typeof knowledgeIndexStatusSchema>;

/**
 * BusinessKnowledgeDocument as returned by services/api
 * (docs/architecture/data-model.md#businessknowledgedocument). The API owns
 * it; the AI service only ever sees what the API sends to the index endpoint.
 */
export const businessKnowledgeDocumentSchema = z.object({
  _id: z.string(),
  businessId: z.string(),
  type: knowledgeDocumentTypeSchema,
  title: z.string(),
  content: z.string(),
  metadata: z.record(z.unknown()).optional(),
  version: z.number().int().positive(),
  indexStatus: knowledgeIndexStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BusinessKnowledgeDocument = z.infer<typeof businessKnowledgeDocumentSchema>;

/** Body of create/update from the dashboard. `version`/`indexStatus` are server-owned. */
export const knowledgeDocumentInputSchema = z.object({
  type: knowledgeDocumentTypeSchema,
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(KNOWLEDGE_CONTENT_MAX_LENGTH),
  metadata: z.record(z.unknown()).optional(),
});
export type KnowledgeDocumentInput = z.infer<typeof knowledgeDocumentInputSchema>;

/**
 * `POST /internal/knowledge/index`. Idempotent: re-indexing the same
 * (documentId, version) replaces that document's chunks, never duplicates
 * them, so it is safe to retry.
 */
export const indexDocumentRequestSchema = z.object({
  businessId: z.string(),
  documentId: z.string(),
  version: z.number().int().positive(),
  type: knowledgeDocumentTypeSchema,
  title: z.string(),
  content: z.string().max(KNOWLEDGE_CONTENT_MAX_LENGTH),
  correlationId: z.string().optional(),
});
export type IndexDocumentRequest = z.infer<typeof indexDocumentRequestSchema>;

export const indexDocumentResponseSchema = z.object({
  status: z.literal("ok"),
  chunkCount: z.number().int().nonnegative(),
  embeddingModel: z.string(),
});
export type IndexDocumentResponse = z.infer<typeof indexDocumentResponseSchema>;

/** Path params of `DELETE /internal/knowledge/:businessId/:documentId` → 204. */
export const deleteDocumentParamsSchema = z.object({
  businessId: z.string(),
  documentId: z.string(),
});
export type DeleteDocumentParams = z.infer<typeof deleteDocumentParamsSchema>;

/**
 * What a suggestion was grounded on. "empty" = the business has no matching
 * knowledge; "failed" = retrieval errored and generation ran without it.
 */
export const retrievalSourceSchema = z.object({
  documentId: z.string(),
  version: z.number(),
  chunkId: z.string(),
  score: z.number(),
});
export type RetrievalSource = z.infer<typeof retrievalSourceSchema>;

export const retrievalInfoSchema = z.object({
  status: z.enum(["used", "empty", "failed"]),
  sources: z.array(retrievalSourceSchema).max(5),
  // Stable hash of the sources' ids+versions → Suggestion.retrievalContextVersion.
  contextVersion: z.string(),
});
export type RetrievalInfo = z.infer<typeof retrievalInfoSchema>;

/** contextVersion when no sources were used, so it is never an empty string. */
export const NO_RETRIEVAL_CONTEXT_VERSION = "none";

/** Returned until retrieval exists, and whenever a business has no knowledge. */
export const emptyRetrieval: RetrievalInfo = {
  status: "empty",
  sources: [],
  contextVersion: NO_RETRIEVAL_CONTEXT_VERSION,
};
