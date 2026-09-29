# AI Service

Internal service boundary for AI functionality.

Endpoints (contracts in `packages/shared`):

- `POST /internal/suggestions` — generate a Hebrew follow-up suggestion. It
  first retrieves the business's matching knowledge, shows it to the model
  (prompt `hebrew-followup-v2`), and reports it in `retrieval` (`used` /
  `empty` / `failed`). A retrieval failure never blocks the suggestion.
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

### Knowledge in the prompt, and the grounding check

- [prompts/hebrew-followup-v2.txt](prompts/hebrew-followup-v2.txt) renders the
  retrieved chunks inside `<business_knowledge>`, best match first. Like
  `<conversation_context>`, it's untrusted data: facts to use, never
  instructions to follow. Our tag names are removed from untrusted text, so
  it can't close a block early.
- [src/knowledge/groundingCheck.ts](src/knowledge/groundingCheck.ts): every
  number in the generated message must appear in the knowledge chunks, the
  conversation or the customer's name (`1,200` = `1200`, `08:00` = `8`,
  `10,000` also allows `10`). Anything else (an invented price, another
  garage's price, the internal `estimatedValue`) makes the attempt
  `invalid_output`, and the usual retry path runs. The log says
  `suggestion failed grounding check` with a count, never the numbers.
- **Not covered by grounding:** a number that a source itself contains. A
  knowledge document saying "offer 50% off" makes "50" grounded. That case is
  covered by the prompt rules and by the mandatory human review before
  sending.

### Retrieval eval

```bash
pnpm --filter @ai-lead-recovery/ai-service eval:retrieval
```

Scores retrieval on [fixtures/knowledge/eval-questions.json](../../fixtures/knowledge/eval-questions.json)
(Erez's 18 questions over the two fixture garages). No Docker needed: it
indexes `garages.json` into a throwaway in-memory store through the real
chunker, embedder and retriever. It prints:

- per question: `hit` / `miss` / `correct_empty` / `noise` at the current
  `RETRIEVAL_*` settings, the right document's rank and score, and the best
  wrong chunk's score (the gap a threshold has to fit into);
- a sweep of every `RETRIEVAL_TOP_K` (1–5) × `RETRIEVAL_MIN_SCORE` (0–0.8)
  pair, and a suggested pair (most correct → fewest misses → smallest k →
  middle of the tied score band);
- all of it twice: query with the case `reason` (what production does) and
  without it.

Only meaningful with `EMBEDDING_PROVIDER=openai` (well under a cent per run).
The mock embedder only matches shared words, and the runner warns when it is
used. It indexes nothing into Qdrant, so the collection size doesn't matter.

To see the same fixture data in the Qdrant dashboard without running
services/api:

```bash
pnpm --filter @ai-lead-recovery/ai-service index:fixtures
```

It indexes into the real `knowledge_chunks` collection under businessIds
`fixture-north` / `fixture-south`, which never collide with the API's
businesses. Re-running replaces the same points. It fails fast with the
"delete the collection" message if the collection was made for another
embedder (below).

### Three-way comparison (Phase 4 exit evidence)

```bash
pnpm --filter @ai-lead-recovery/ai-service eval:compare                    # estimate only
pnpm --filter @ai-lead-recovery/ai-service eval:compare --yes --messages   # run it
```

Runs every eval question through the production generator (prompt v2,
retries, grounding) in three modes: **no knowledge**, **all knowledge** (every
chunk of the garage in the prompt) and **rag**. It prints a Markdown table
(right document shown, answered, facts stated, numbers from a wrong
document, grounding rejects, degraded, tokens per question, cost) and a
per-question breakdown. `--messages` also prints every reply.

- Needs `AI_PROVIDER=anthropic` + `AI_API_KEY`. With the mock AI, all three rows
  are the same, because the mock ignores knowledge. The rag row also needs
  `EMBEDDING_PROVIDER=openai` and the Stage 7 settings. The runner warns about
  both.
- Nothing is sent to a paid model without `--yes`. The estimate comes first:
  about $0.60 typical and about $5 worst case on `claude-opus-5`.
- Primary model only, no fallback, so every row is one model's work.

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
