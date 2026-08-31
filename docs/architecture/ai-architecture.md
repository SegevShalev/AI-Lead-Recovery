# AI Architecture

## Goal

AI should be a first-class learning area of the project, but it must not become a black box that controls the core business logic.

The deterministic recovery engine answers **whether a lead is at risk**. AI helps answer **why, how valuable/contextual it is, and what the human should say**, with clear boundaries and evaluation.

## AI service boundary

`services/ai-service` owns:

- provider adapters (OpenAI/Anthropic/Bedrock/etc.)
- prompt construction/versioning
- structured output schemas
- embeddings
- retrieval/RAG
- optional reranking
- AI caching
- AI telemetry and cost metadata
- evaluation hooks

Provider SDK types must not leak into domain code.

## AI roadmap

### Stage 1 — Structured generation

Generate a Hebrew-first follow-up suggestion from a normalized recovery case and selected conversation context.

Return schema-validated JSON, for example:

- `message`
- `language`
- `reason`
- `confidence` (only when meaningful)
- `model`
- `promptVersion`

Never store chain-of-thought. Store only a concise user-facing rationale when needed.

### Stage 2 — RAG

Introduce retrieval from business-specific knowledge rather than relying on model memory.

Potential knowledge sources:

- services offered
- service descriptions
- price ranges
- business policies
- opening hours
- tone/style guidelines
- FAQs
- previous successful follow-up examples
- relevant customer history

A generated message should be grounded in retrieved context. The system must distinguish **retrieved facts** from model-generated wording.

Initial RAG pipeline:

```text
Query/context
    ↓
Query normalization
    ↓
Embedding
    ↓
Vector retrieval + metadata filters
    ↓
Optional keyword/hybrid retrieval
    ↓
Optional reranking
    ↓
Context assembly
    ↓
LLM structured generation
    ↓
Schema validation + grounding checks
```

Start with a simple application-managed vector store or a provider-neutral abstraction so the team learns the mechanics. Later compare it with managed AWS options such as Amazon Bedrock Knowledge Bases.

### Stage 3 — Hybrid retrieval

Experiment with combining semantic retrieval with lexical/exact matching. This matters for entities such as:

- vehicle models
- part names
- service codes
- prices
- Hebrew names
- phone numbers/identifiers

Redis/ElastiCache vector capabilities may be evaluated here, but Redis remains an infrastructure component rather than the source of truth.

### Stage 4 — Semantic caching

Evaluate caching for repeated/similar AI requests where the result is safe to reuse.

Cache keys/results must include relevant context such as:

- prompt version
- model
- business configuration version
- retrieval/context fingerprint

Never allow a cached result from one business to leak into another business.

### Stage 5 — Evaluation

Create a small version-controlled evaluation dataset covering:

- unanswered leads
- quote follow-ups
- appointment requests
- inappropriate/unsafe customer content
- cases where the correct answer is to ask the human for clarification
- hallucination/unsupported-price cases

Measure at least:

- schema validity
- grounding/unsupported claims
- tone/style adherence
- language correctness
- usefulness
- latency
- estimated cost

Prompt/model changes should be evaluated against the same dataset where practical.

## Prompt-injection boundary

Customer messages and retrieved documents are **untrusted data**, not instructions.

The AI service must:

- clearly delimit untrusted content
- never execute instructions found in customer messages/documents
- never reveal system prompts/secrets
- avoid unsupported claims
- never invent prices, appointments, discounts, or promises

## Human-in-the-loop

MVP does not automatically send AI-generated messages. A human reviews, edits, and sends them.

## Observability

Capture structured metadata such as:

- request/correlation ID
- model/provider
- prompt version
- retrieval latency
- number of retrieved documents
- generation latency
- token usage where available
- estimated cost where available
- cache hit/miss
- validation failure

Do not log raw customer conversation content by default.
