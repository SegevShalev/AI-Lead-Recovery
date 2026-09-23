# ADR-003: Qdrant as the vector store for RAG

## Status

Accepted (Phase 4, agreed by Erez and Segev)

## Context

Phase 4 adds retrieval: the AI service must find the business-specific
knowledge (prices, hours, policies) relevant to a conversation before
generating a suggestion. That needs somewhere to store chunk embeddings and
search them by similarity, always filtered to one business.

Options considered:

- **MongoDB + cosine similarity in code** — no new container, but it teaches
  nothing about vector databases and does a full scan per query.
- **MongoDB Atlas Vector Search** — not available in the local Mongo image,
  breaks "local first".
- **pgvector / OpenSearch** — would add a second general-purpose database just
  to store vectors.
- **Qdrant** — a dedicated vector database with a local Docker image.

## Decision

Use **Qdrant** (`qdrant/qdrant` in `docker-compose.yml`, ports 6333/6334),
owned by the AI service, behind a `VectorStore` interface.

- It is the targeted technology to learn (AGENTS.md dependency rule): payload
  filtering, HNSW indexes, distance metrics.
- Its dashboard (`http://localhost:6333/dashboard`) shows stored points and
  projects them onto a 2D map, so we can _see_ topics cluster and businesses
  stay separate.
- `businessId` is a payload field with a payload index and a **required**
  argument of `VectorStore.search()` — tenant isolation is not optional.

## Consequences

- Qdrant holds a **derived index**, not source of truth. The API's
  `BusinessKnowledgeDocument`s are; the index can always be rebuilt from them
  (same stance as Redis in AGENTS.md). Losing the Qdrant volume is an
  inconvenience, not data loss.
- One more container locally. Free.
- AWS hosting is undecided: another ECS task with an EFS volume, or Qdrant
  Cloud. Decide in Phase 6 with a cost estimate. The `VectorStore` interface
  keeps OpenSearch/pgvector swappable if that decision goes the other way.
- Qdrant types must not leak outside the `VectorStore` implementation.
