# Development Roadmap

The project is a learning-oriented real system. Ship vertical slices, but intentionally expose modern cloud/AI concepts over time.

## Phase 0 — Repository foundation

- pnpm workspace/monorepo
- TypeScript configuration
- lint/format/test/typecheck
- shared Zod contracts
- service templates
- Docker basics

## Phase 1 — Local product slice

- MongoDB
- Redis
- API
- fake WhatsApp webhook
- message persistence
- local queue adapter
- Recovery Worker
- unanswered-message rule
- dashboard

**Exit:** a seeded Hebrew demo conversation can become an open recovery case visible in the UI.

## Phase 2 — Real async microservice behavior

- SQS adapter
- DLQ
- retries/backoff
- idempotency
- correlation IDs
- worker health checks
- Redis cache/invalidation

**Exit:** the API and worker are independently runnable processes communicating through a durable queue.

## Phase 3 — AI service

- provider-neutral `SuggestionGenerator`
- one real model adapter
- structured output with Zod
- prompt versioning
- Hebrew follow-up generation
- human review flow
- AI failure/degraded mode

**Exit:** user can request and review a grounded, schema-valid follow-up suggestion.

## Phase 4 — RAG

- business knowledge documents
- chunking strategy
- embeddings
- vector retrieval
- metadata filtering by business
- context assembly
- grounding checks
- retrieval tracing

Then experiment with hybrid lexical + semantic retrieval.

**Exit:** the model can use business-specific facts without putting those facts into the prompt manually each time.

## Phase 5 — AI engineering

- evaluation dataset
- automated eval runner
- prompt/model comparison
- semantic caching
- token/cost tracking
- latency tracking
- OpenTelemetry traces
- retrieval quality measurements

**Exit:** changes to prompts/models can be measured instead of judged only by eyeballing examples.

## Phase 6 — AWS deployment

CDK provisions:

- VPC
- ECR
- ECS/Fargate
- ALB
- SQS + DLQ
- ElastiCache Redis OSS/Valkey as selected
- IAM
- CloudWatch
- secrets/configuration

### 6.1 — Build and validate the CDK stack against Floci

Before pointing this stack at a real AWS account, exercise the full CDK deploy
locally against [Floci](https://github.com/floci-io/floci) (MIT, free local
AWS emulator, drop-in replacement for the LocalStack SQS setup from Phase 2).
Unlike LocalStack Community, it emulates ECS/ALB/IAM/ElastiCache without a
paid tier, which matches the "local first, AWS second" cost rule in
AGENTS.md. Small maintainer team (2 people); confirm it's still active before
adopting.

**Exit:** the CDK stack deploys and runs cleanly against Floci with no AWS
account involved.

### 6.2 — Deploy to real AWS

Point the same CDK stack at a real AWS account. Deploy API, Recovery Worker
and AI Service as separate ECS services.

## Phase 7 — Event-driven expansion

Only if useful:

- EventBridge domain events
- notifications consumer
- analytics consumer
- additional asynchronous workflows

## Phase 8 — Real WhatsApp integration

Research and implement the official WhatsApp Business Platform/BSP path after the simulated ingestion pipeline is stable. The PRD explicitly identifies access, cost and messaging-policy questions as risks. Do not let provider access block earlier learning.

## Phase 9 — Advanced experiments

Optional:

- reranking
- agentic workflows where genuinely useful
- GraphRAG/knowledge graphs
- learned lead scoring
- additional channels

These are experiments, not prerequisites for the product.
