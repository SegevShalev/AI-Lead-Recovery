# AI Service

Internal service boundary for AI functionality.

Endpoints (contracts in `packages/shared`):

- `POST /internal/suggestions` — generate a Hebrew follow-up suggestion.
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

- One Qdrant collection per embedding model: `knowledge_chunks__<model>`,
  e.g. `knowledge_chunks__mock-hash-256`. Switching `EMBEDDING_PROVIDER`
  uses another collection, so reindex after switching.
- The service starts even when Qdrant is down; it keeps retrying collection
  setup in the background and logs `knowledge collection ready` once done.
- Browse the stored chunks at <http://localhost:6333/dashboard> → the
  collection → **Visualize** (PCA, color by `businessId`).
- Logs carry ids, counts, scores and latency only — never document or customer text.
