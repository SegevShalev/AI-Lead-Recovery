# Data Model

Use MongoDB with Mongoose initially.

## Business

- `_id`
- `name`
- `vertical`
- `currency` = ILS
- `averageTicketValue`
- `settingsVersion`
- `createdAt`
- `updatedAt`

## Customer

- `_id`
- `businessId`
- `displayName`
- `phone`
- `createdAt`
- `updatedAt`

## Conversation

- `_id`
- `businessId`
- `customerId`
- `channel` = whatsapp
- `status`
- `lastMessageAt`
- `createdAt`
- `updatedAt`

## Message

- `_id`
- `conversationId`
- `direction` = inbound | outbound
- `text`
- `occurredAt`
- `externalMessageId`
- `metadata`

## RecoveryCase

- `_id`
- `businessId`
- `conversationId`
- `customerId`
- `type` = unanswered | quote_no_response | appointment_no_confirmation | dormant_customer
- `status` = open | handled | won | lost | no_response
- `estimatedValue`
- `reason`
- `detectedAt`
- `lastEvaluatedAt`
- `suggestionId`
- timestamps

## BusinessKnowledgeDocument

RAG source owned by the business domain/API:

- `_id`
- `businessId`
- `type` = service | policy | faq | style | example | other
- `title`
- `content`
- `metadata`
- `version`
- `createdAt`
- `updatedAt`

Vector/index-specific representation must remain behind the AI/retrieval abstraction; do not make the application depend on a particular vector database schema.

## Suggestion

- `_id`
- `recoveryCaseId`
- `businessId`
- `language`
- `message`
- `reasoningSummary`
- `model`
- `promptVersion`
- `retrievalContextVersion` (optional)
- `createdAt`

Avoid storing chain-of-thought.

## AI request metadata

Store minimal operational metadata where useful:

- provider/model
- latency
- token counts if available
- estimated cost if available
- cache hit/miss
- retrieval document IDs/versions
- validation status

Do not store raw prompts/responses indefinitely by default.

## Indexes

Start with:

- Conversation `{businessId, lastMessageAt}`
- Message `{conversationId, occurredAt}`
- RecoveryCase `{businessId, status, detectedAt}`
- Message unique `{externalMessageId}` when available
- BusinessKnowledgeDocument `{businessId, type, version}`
