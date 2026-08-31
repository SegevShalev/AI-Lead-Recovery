# System Architecture

## Decision summary

Use a TypeScript monorepo with:
- React + Vite frontend
- Node.js + Express API service
- Node.js + TypeScript Recovery Worker microservice
- Node.js + TypeScript AI service
- MongoDB as the primary application datastore
- Redis for cache, idempotency, short-lived coordination, and later semantic-cache experiments
- Amazon SQS for durable asynchronous work
- optional EventBridge later for domain-event fan-out
- AWS ECS Fargate for containerized backend services
- ALB for public HTTP entry
- ECR for images
- CloudWatch/OpenTelemetry for observability
- AWS CDK in TypeScript for infrastructure

The architecture is intentionally a **small microservice system**, not a collection of tiny services. Three independently runnable services provide useful boundaries without turning the learning project into distributed-system bureaucracy.

## Services

### API service

Synchronous product boundary. Owns business/customer/conversation APIs and persistence operations for those domains.

### Recovery Worker

Asynchronous domain-processing microservice. Consumes events and evaluates recovery rules. Owns recovery-case processing.

### AI Service

Internal AI boundary. Owns model providers, RAG, embeddings, prompts, structured generation, AI caching, and AI observability.

## Runtime flow

```text
React
  │
  ▼
API ───────────────► MongoDB
  │
  ├───────────────► Redis
  │
  └───────────────► SQS ─────► Recovery Worker ─────► MongoDB
                                      │
                                      └────► Redis

API ─────► AI Service
             │
             ├── Retrieval / RAG
             ├── Embeddings
             ├── LLM provider
             └── AI evaluation/telemetry
```

1. A demo webhook posts a WhatsApp-like inbound message to API.
2. API validates and persists normalized data in MongoDB.
3. API publishes a versioned event to SQS.
4. Recovery Worker consumes the event and applies deterministic rules.
5. Worker creates/updates a RecoveryCase.
6. Redis caches dashboard aggregates and handles idempotency/short-lived locks where appropriate.
7. Web requests dashboard data from API.
8. User requests a suggestion; API calls AI Service.
9. AI Service retrieves relevant business/customer context, generates structured output, validates it, and returns it.
10. API stores the suggestion. Human reviews before sending.

## Why microservices here?

This is intentionally a learning project, so the boundaries should teach real concepts:
- synchronous vs asynchronous communication
- queue retries and DLQs
- idempotency
- independent service processes
- service contracts
- containerization
- service-to-service networking
- AI isolation

Do not create additional services until there is a concrete ownership, scaling, deployment, or learning reason.

## Event-driven architecture

SQS is the primary durable work queue.

Later, introduce EventBridge for domain events when multiple independent consumers make that useful, for example:
- `LeadRecovered`
- `RecoveryCaseCreated`
- `FollowupGenerated`

Do not introduce EventBridge before there is a real fan-out use case.

## Data ownership

MongoDB is shared infrastructure initially, but ownership is explicit:
- API owns Business/Customer/Conversation/Message persistence.
- Recovery Worker owns RecoveryCase persistence.
- AI Service should not become the source of truth for product data.

Cross-service communication must use contracts, not implicit access to another service's collections.

## Local development

Use Docker Compose for MongoDB and Redis. Use a local queue adapter by default. An optional LocalStack/SQS mode may be added for AWS-like integration testing.

The core application must run without AWS credentials.

## Production target

Internet → ALB → API → MongoDB
                         │
                         ├→ SQS → Recovery Worker
                         │             │
                         │             └→ Redis
                         │
                         └→ AI Service → RAG/vector retrieval → LLM

Later, web assets can move to S3 + CloudFront.

## Failure philosophy

- Redis failure must not destroy source data.
- SQS redelivery must be safe.
- Worker retries must be idempotent.
- Poison messages go to a DLQ.
- AI failure must not prevent deterministic recovery detection.
- RAG failure should degrade to a clearly marked non-RAG generation path only when safe.
