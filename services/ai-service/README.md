# AI Service

Internal service boundary for AI functionality.

Endpoints (contracts in `packages/shared`):

- `POST /internal/suggestions` — generate a Hebrew follow-up suggestion. It
  first retrieves the business's matching knowledge and reports it in
  `retrieval` (`used` / `empty` / `failed`). A retrieval failure never blocks
  the suggestion.
- `POST /internal/knowledge/index` — chunk → embed → store one knowledge
  document. Same or newer `version` replaces its chunks; an older one is a
  no-op (still 200). 400 invalid body, 422 the provider rejected the
  document, 503 embedding provider or Qdrant unavailable.
- `DELETE /internal/knowledge/:businessId/:documentId` — 204, also for a
  document that was never indexed; 503 if Qdrant is unavailable.

The service should remain provider-agnostic. A local deterministic/mock provider is acceptable until the rest of the application is working.

## Knowledge index (Phase 4)

`src/knowledge/`: `chunker` → `Embedder` (`MockEmbedder` | `OpenAIEmbedder`)
→ `VectorStore` (`QdrantVectorStore` | `InMemoryVectorStore` for tests).
`KnowledgeRetriever` builds a query from the case reason and the latest
inbound messages, embeds it, and searches only that business's chunks
(`RETRIEVAL_TOP_K`, `RETRIEVAL_MIN_SCORE`).

- One Qdrant collection, `knowledge_chunks`, sized for the current embedder
  (mock: 256 dims, OpenAI: 1536).
- The service starts even when Qdrant is down; it keeps retrying collection
  setup in the background and logs `knowledge collection ready` once done.

### Switching the embedding provider

> ⚠️ Applies whenever `EMBEDDING_PROVIDER` changes between `mock` and `openai`.

The collection can hold only one embedder's vectors. At startup the service
checks both the vector size and the model name stored on the chunks, so a switch
to another model with the same vector size is caught too. After changing
`EMBEDDING_PROVIDER`, the service logs this error and keeps retrying:

```
knowledge collection was made for another embedder
```

Until you fix it, indexing answers 503 (the API saves documents as
"pending") and suggestions still work, just without knowledge. To fix it:

```bash
curl -X DELETE http://localhost:6333/collections/knowledge_chunks
```

Then restart ai-service, or wait up to 30 s for its next retry, and reindex
the documents from the dashboard. It's always safe to delete: the collection
is a derived index, and the API's documents are the source of truth.

Two places this bites:

- **Degrade check with a bad `EMBEDDING_API_KEY`:** delete the collection
  first. Otherwise retrieval fails because of the size mismatch, not the bad
  key, and the check passes for the wrong reason.
- **Automated tests are not affected.** They use their own temporary
  collections or the in-memory store.
- Browse the stored chunks at <http://localhost:6333/dashboard> → the
  collection → **Visualize** (PCA, color by `businessId`).
- Logs carry ids, counts, scores and latency only — never document or customer text.
