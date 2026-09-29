import {
  indexDocumentResponseSchema,
  type IndexDocumentRequest,
  type IndexDocumentResponse,
} from "@ai-lead-recovery/shared";

export type KnowledgeIndexFailure = { ok: false; errorCode: "unreachable" | "invalid_response" };

export type IndexDocumentResult = { ok: true; data: IndexDocumentResponse } | KnowledgeIndexFailure;
export type DeleteDocumentResult = { ok: true } | KnowledgeIndexFailure;

export interface KnowledgeIndexClient {
  indexDocument(request: IndexDocumentRequest): Promise<IndexDocumentResult>;
  deleteDocument(
    businessId: string,
    documentId: string,
    correlationId?: string,
  ): Promise<DeleteDocumentResult>;
}

/**
 * The owner is waiting on a save while this runs (indexing is synchronous,
 * docs/development/phase-4-checklist.md decision 2), so a slow AI service
 * must not hang the request — past this, the document is saved as "pending".
 */
const INDEX_TIMEOUT_MS = 5_000;

/**
 * Talks to services/ai-service's `/internal/knowledge` endpoints. Same
 * failure collapsing as createHttpSuggestionClient: network error, timeout
 * or non-2xx → "unreachable"; a 2xx body that breaks the contract →
 * "invalid_response". Callers never see a thrown error.
 */
export function createHttpKnowledgeIndexClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): KnowledgeIndexClient {
  async function send(url: string, init: RequestInit): Promise<Response | null> {
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
      });
      return response.ok ? response : null;
    } catch {
      return null;
    }
  }

  return {
    async indexDocument(request) {
      const response = await send(`${baseUrl}/internal/knowledge/index`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response) return { ok: false, errorCode: "unreachable" };

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { ok: false, errorCode: "invalid_response" };
      }
      const parsed = indexDocumentResponseSchema.safeParse(body);
      if (!parsed.success) return { ok: false, errorCode: "invalid_response" };
      return { ok: true, data: parsed.data };
    },

    async deleteDocument(businessId, documentId, correlationId) {
      const url = `${baseUrl}/internal/knowledge/${encodeURIComponent(businessId)}/${encodeURIComponent(documentId)}`;
      const response = await send(url, {
        method: "DELETE",
        headers: correlationId ? { "x-correlation-id": correlationId } : {},
      });
      return response ? { ok: true } : { ok: false, errorCode: "unreachable" };
    },
  };
}
