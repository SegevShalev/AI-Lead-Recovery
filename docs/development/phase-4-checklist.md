# Phase 4 Checklist — RAG

Working split for Phase 4 of the [roadmap](roadmap.md). Same shape as
[Phase 3](phase-3-checklist.md): two tracks, plus seams both of us verify
together. Tracks are swapped this phase.

**Exit criteria (roadmap):** the model can use business-specific facts without
putting those facts into the prompt manually each time.

**New to vectors/RAG?** Start with the [RAG playground](rag-playground.md)
(~20 min, local only) — it demonstrates why the `businessId` filter and the
score threshold below matter, on real embeddings.

**Prerequisite (done):** Phase 3's shared degraded-mode seam was verified end
to end on 2026-09-22, so Phase 4 starts from a known-good failure path.

Current state: the contract below is in `packages/shared` and the AI service
already returns `retrieval: { status: "empty", ... }` on every suggestion, so
both tracks build against real types from day one. No
`BusinessKnowledgeDocument` model in `services/api` yet, and
`services/ai-service` has no storage at all yet — retrieval needs one.

## Decisions — agreed by Erez and Segev

1. **Ownership split (follows [data-model.md](../architecture/data-model.md#businessknowledgedocument)).**
   The API owns the _source_ documents (`BusinessKnowledgeDocument`, CRUD).
   The AI service owns the _derived_ index (chunks + embeddings) in its own
   collection (`knowledge_chunks`). The API never reads chunks, the AI service
   never reads `BusinessKnowledgeDocument` — it only sees what the API sends it.
2. **Indexing is a synchronous HTTP call** API → AI service on document
   create/update/delete. Documents change rarely (an owner edits a price list),
   so a queue buys little today. An async `business.knowledge.updated` event
   over SQS is a reasonable later upgrade if indexing gets slow.
3. **Vector store: Qdrant** (new `qdrant/qdrant` container in
   `docker-compose.yml`, ports 6333/6334), behind a `VectorStore` interface.
   Why a real vector DB instead of Mongo + cosine-in-code:
   - it's the targeted technology to learn (AGENTS.md dependency rule) —
     payload filtering, HNSW indexes, distance metrics;
   - its built-in dashboard (`http://localhost:6333/dashboard`) shows the
     stored points and can project them onto a 2D map, so we can _see_
     chunks of the same topic cluster together and different businesses'
     data stay separate;
   - the chunks are a **derived index**, not source of truth — the API's
     `BusinessKnowledgeDocument`s are, and the index can always be rebuilt
     from them (same stance as Redis in AGENTS.md).
     `businessId` is stored as a payload field with a payload index and is a
     mandatory filter on every search. Cost/AWS: free locally; in AWS it's
     either another ECS task with an EFS volume or Qdrant Cloud — decide in
     Phase 6, the `VectorStore` interface keeps OpenSearch/pgvector swappable.
     Recorded in [ADR-003](../decisions/ADR-003-qdrant-vector-store.md).
4. **Embedding provider: OpenAI `text-embedding-3-small`** (1536 dims,
   handles Hebrew, cheap — cents for our whole dataset). New env vars
   `EMBEDDING_PROVIDER` / `EMBEDDING_API_KEY`, separate from the Anthropic
   generation key. Plus a deterministic **mock embedder**
   (`EMBEDDING_PROVIDER=mock`, the default) so local dev and tests need no
   key — same idea as `AI_PROVIDER=mock`.
5. **Suggestion request is unchanged.** The AI service already receives
   `businessId`; it runs retrieval itself. The API doesn't pick facts.

## Contract additions — agreed by Erez and Segev

Lives in `packages/shared/src/knowledge.ts` (new) +
`packages/shared/src/suggestions.ts` (extended).

**Indexing** (API → AI service):

```ts
// POST /internal/knowledge/index
export const indexDocumentRequestSchema = z.object({
  businessId: z.string(),
  documentId: z.string(),
  version: z.number().int().positive(),
  type: z.enum(["service", "policy", "faq", "style", "example", "other"]),
  title: z.string(),
  content: z.string().max(20_000),
  correlationId: z.string().optional(),
});
// 200 → { status: "ok", chunkCount: number, embeddingModel: string }
// Idempotent: re-indexing the same (documentId, version) replaces that
// document's chunks, never duplicates them. Safe to retry.

// DELETE /internal/knowledge/:businessId/:documentId → 204
```

**Suggestion response** — `suggestionResultSchema` gains:

```ts
retrieval: z.object({
  status: z.enum(["used", "empty", "failed"]),
  // "empty" = business has no matching knowledge; "failed" = retrieval errored
  // and generation ran without it (see degrade rule below)
  sources: z
    .array(z.object({
      documentId: z.string(),
      version: z.number(),
      chunkId: z.string(),
      score: z.number(),
    }))
    .max(5),
  contextVersion: z.string(), // stable hash of sources' ids+versions → Suggestion.retrievalContextVersion
}),
```

**Degrade rule** (per [system-architecture.md](../architecture/system-architecture.md)):
if retrieval fails, generate without context and return `retrieval.status:
"failed"`. That's safe _only_ because the prompt already forbids inventing
prices/appointments — the grounding check below enforces it.

## Track 1 — Retrieval pipeline inside `services/ai-service` (Segev)

Doesn't touch `services/api` or `apps/web`.

- [ ] **Qdrant in `docker-compose.yml`** + a `knowledge_chunks` collection
      owned by the AI service (cosine distance, payload index on
      `businessId`), created on startup if missing.
- [ ] **Chunker** — short types (`service`, `faq`) = one chunk per document;
      long text split on paragraphs (~500 chars, small overlap). Pure function,
      unit-tested with Hebrew text.
- [ ] **`Embedder` interface** + mock embedder + one real adapter (decision 4).
      Provider SDK types stay behind it.
- [ ] **`VectorStore` interface** + Qdrant implementation (decision 3).
      `businessId` is a required argument of `search()`, not an optional filter.
- [ ] **`POST /internal/knowledge/index` + `DELETE`** per the contract.
- [ ] **Retriever** — builds the query from the conversation context (latest
      inbound messages + case reason), embeds it, top-k (k=5, with a minimum
      score so irrelevant chunks are dropped). **Tune the threshold on the
      eval set, don't guess it** — in the [playground](rag-playground.md) run
      a correct match scored only 0.28 while an irrelevant one scored 0.46,
      so a naive 0.3 cut would have dropped the right answer.
- [ ] **Context assembly** — new prompt version (`hebrew-followup-v2`) with a
      `<business_knowledge>` block. Retrieved text is untrusted data, same
      treatment as `<conversation_context>`.
- [ ] **Grounding check** — deterministic: every number/price in the
      generated message must appear in the retrieved chunks or the
      conversation. Fail → `invalid_output` (retryable, existing retry path).
- [ ] **Retrieval tracing** — structured log: chunk ids, scores, latency,
      status. No raw chunk or customer text in logs.
- [ ] Tests: chunker, cross-business isolation at the `VectorStore` level,
      retrieval failure → `status: "failed"` still returns a suggestion,
      grounding check rejects an invented price, injection text inside a
      knowledge document is not followed.

## Track 2 — Knowledge management + wiring (Erez)

Doesn't touch embeddings, retrieval, or prompt content. Builds against Track
1's mock embedder from day one.

- [ ] **`BusinessKnowledgeDocument` model** in `services/api` per
      [data-model.md](../architecture/data-model.md#businessknowledgedocument)
      (index `{businessId, type, version}`), plus Zod schema in shared.
- [ ] **CRUD routes** `/api/businesses/:businessId/knowledge` — every write
      bumps `version` and calls `/internal/knowledge/index` (or `DELETE`).
      If the AI service is down: save the document anyway, mark it
      `indexStatus: "pending"`, and expose a "reindex" action — don't lose the
      owner's edit.
- [ ] **Seed data** — Hebrew garage knowledge for _two_ businesses
      (price list, hours, warranty policy) in `services/api/src/scripts/seed.ts`,
      with deliberately different prices so a leak is obvious.
- [ ] **Persist retrieval metadata** — `Suggestion.retrievalContextVersion` +
      source ids from the new `retrieval` field.
- [ ] **Dashboard** — a simple knowledge page (list/add/edit/delete) and, in
      the Recover flow, a "based on:" line showing which documents the
      suggestion used (or "no business knowledge used").

## Shared — do together, not split

- [x] **Agree decisions 1–5 and the contract above** before code
      (agreed by Erez and Segev).
- [x] **Contract code** — `packages/shared/src/knowledge.ts` + required
      `retrieval` on `suggestionResultSchema`; AI service returns
      `emptyRetrieval` until Track 1's retriever replaces it.
- [x] **ADR-003** — [vector store choice (Qdrant) and why](../decisions/ADR-003-qdrant-vector-store.md).
- [ ] **Tenant-isolation seam** — two seeded garages with different brake
      prices. Request suggestions for both end to end; garage A's price must
      never appear in garage B's suggestion or `sources`.
- [ ] **Degrade seam** — stop the embedding provider (bad key); suggestion
      still comes back, marked `retrieval.status: "failed"`, dashboard says
      no knowledge was used.
- [ ] **Eval set (build early, reuse on every change)** — a fixed list of
      10–20 customer questions against the seeded garages, each labelled with
      the knowledge chunk that _should_ come back (and some with no correct
      chunk, to check we return nothing rather than noise). Checked into the
      repo so every chunking/threshold/model/prompt change is measured on the
      same set, not eyeballed on two examples.
- [ ] **Three-way comparison (exit evidence)** — run the eval set through
      (a) **no knowledge** — today's Phase 3 behaviour; (b) **all knowledge**
      — every chunk of the business pasted into the prompt, no retrieval (a
      garage has tens of chunks, so this is a real option, not a strawman);
      (c) **RAG** — retrieval as built above. Measure: retrieval hit rate
      (right chunk in top-k, for c), correct facts in the message, invented
      facts in the message, prompt tokens per request (cost). Per AGENTS.md,
      don't claim RAG helps until this shows it. If "all knowledge" wins at
      our data size, that's a legitimate result — keep it and record why.
      Results go in the PR.
- [ ] **Improve against the eval, one change at a time** — levers in rough
      order of cost: chunking, query construction (last message vs whole
      window), k + score threshold, embedding model, hybrid lexical search,
      reranking, prompt wording. Re-run the full set after each change.

## After exit (not blocking)

- Hybrid retrieval: add lexical/exact matching and compare on entity-heavy
  queries (car models, part names, prices) — roadmap's "then experiment" item.
- Visual check in the Qdrant dashboard: seeded garages' chunks, colored by
  `businessId`, clustered by topic.
