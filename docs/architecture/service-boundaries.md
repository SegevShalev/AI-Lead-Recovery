# Service Boundaries

## `apps/web`

Owns:

- dashboard UI
- recovery-case interaction
- human approval/editing of AI suggestions

Does not own persistence or AI provider calls.

## `services/api`

Owns:

- HTTP API
- minimal/dev auth boundary
- webhook ingestion adapter boundary
- Business/Customer/Conversation/Message persistence
- dashboard read endpoints
- RecoveryCase read/update endpoints
- calling AI Service

Important initial endpoints:

- `POST /dev/webhooks/whatsapp`
- `GET /api/dashboard`
- `GET /api/recovery-cases`
- `GET /api/recovery-cases/:id`
- `POST /api/recovery-cases/:id/suggestion`

## `services/recovery-worker`

Required microservice.

Owns:

- recovery rule evaluation
- recovery-case creation/update
- scheduled/background processing

Consumes versioned SQS events. It must not depend on API process memory.

First rule:

- unanswered inbound message

Later rules:

- quote without response
- appointment without confirmation
- dormant repeat customer

Implement rules behind a small explicit rule interface; do not over-generalize prematurely.

## `services/ai-service`

Internal AI microservice.

Owns:

- LLM provider adapter
- prompt templates/versioning
- structured output validation
- embeddings
- RAG/retrieval
- optional reranking
- AI semantic caching
- AI telemetry/evaluation hooks

Example endpoint:
`POST /internal/suggestions`

Optional future internal endpoints:

- `POST /internal/embeddings`
- `POST /internal/retrieve`
- `POST /internal/evals/run`

AI Service must not know about React and should not directly mutate core product entities.

## Event contract

Example:

```json
{
  "eventType": "conversation.message.received",
  "eventVersion": 1,
  "eventId": "uuid",
  "occurredAt": "ISO-8601",
  "tenantId": "demo-tenant",
  "conversationId": "conversation-id",
  "messageId": "message-id"
}
```

Consumers must use `eventId` for idempotency.

## Redis usage

Use Redis for:

- dashboard aggregate caching with TTL
- idempotency keys
- short-lived locks
- rate limiting later
- semantic AI caching experiments later

Do not use Redis as the authoritative store for product entities.

## Future EventBridge boundary

If multiple consumers need the same domain event, publish domain events through EventBridge rather than making producers call every consumer directly. Keep SQS for durable work processing.
