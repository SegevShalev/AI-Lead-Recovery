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
  content: z.string().max(20_000),
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
