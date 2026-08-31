# Bootstrap Prompt — AI Lead Recovery

You are the primary coding agent for this repository.

## Context

We are two developers building AI Lead Recovery as a real learning project. The product is a revenue-recovery layer for small businesses, initially Hebrew-first and WhatsApp-first. The attached PRD is the product source of truth.

Our priorities, in order:

1. Learn modern AI application engineering.
2. Learn AWS/cloud by actually deploying.
3. Practice real microservices and distributed-system patterns.
4. Use Redis meaningfully.
5. Eventually ship a real working thing.
6. Avoid building a huge SaaS prematurely.

We specifically want hands-on exposure to RAG, embeddings, retrieval, structured LLM outputs, AI evaluation/observability, queues, containers and infrastructure-as-code.

## Read first

Before writing code, read:

- `AGENTS.md`
- `docs/product/PRD.md`
- `docs/architecture/system-architecture.md`
- `docs/architecture/service-boundaries.md`
- `docs/architecture/data-model.md`
- `docs/architecture/aws-infrastructure.md`
- `docs/architecture/ai-architecture.md`
- `docs/development/roadmap.md`
- `.cursor/rules/*`
- relevant `skills/*/SKILL.md`

## Target architecture

Create a TypeScript monorepo containing:

- `apps/web` — React + Vite
- `services/api` — Node.js + Express
- `services/recovery-worker` — independently running microservice
- `services/ai-service` — independently running internal AI microservice
- `packages/shared` — versioned Zod/event contracts and shared primitives
- `infra/cdk` — AWS CDK TypeScript

Infrastructure:

- MongoDB
- Redis
- SQS + DLQ
- ECS/Fargate
- ECR
- ALB
- CloudWatch
- Secrets Manager/SSM as appropriate

AI direction:

- provider-neutral AI service
- structured outputs
- RAG over business-specific knowledge
- embeddings
- hybrid retrieval experiment later
- semantic caching experiment later
- evaluation dataset/runner
- OpenTelemetry/AI telemetry

## Important architectural stance

Do NOT interpret this as a request to create many tiny microservices.

Three services are intentional:

1. API — synchronous product boundary
2. Recovery Worker — asynchronous domain processing
3. AI Service — AI/provider/RAG boundary

Do not create a fourth service without explaining the concrete reason first.

## First working vertical slice

Implement this end-to-end before attempting the full AI/RAG system:

1. `POST /dev/webhooks/whatsapp` accepts a normalized demo inbound message.
2. API validates the event and writes business/customer/conversation/message data to MongoDB.
3. API publishes `conversation.message.received`.
4. Local development uses a local queue adapter; production uses SQS.
5. Recovery Worker consumes the event.
6. Worker detects an unanswered inbound message using a configurable threshold.
7. Worker creates/updates a `RecoveryCase` in MongoDB.
8. Redis is used for dashboard aggregate caching and event idempotency.
9. API exposes dashboard/recovery-case endpoints.
10. React shows potential recoverable revenue and open recovery cases.
11. Seed realistic Hebrew garage conversations.

Do not start with real WhatsApp integration.

## AI milestone after the vertical slice

Once the deterministic path works:

1. Implement AI Service with a provider interface.
2. Add a real model adapter, but keep a deterministic/mock adapter for tests/local development.
3. Generate a Hebrew follow-up suggestion using structured output.
4. Validate with Zod.
5. Add prompt versioning.
6. Add business knowledge documents.
7. Build a simple RAG pipeline:
   - chunk
   - embed
   - retrieve
   - metadata-filter by business
   - assemble context
   - generate
8. Add retrieval metadata to the result so we know what context was used.
9. Add grounding/unsupported-claim checks.
10. Add a small evaluation dataset and runner.

Do not automatically send messages.

## RAG requirements

RAG is a learning objective, not a checkbox.

The first knowledge corpus should contain realistic garage information such as:

- services
- service descriptions
- indicative price ranges
- opening hours
- policies
- communication style
- FAQ

The retrieval API should be provider-neutral enough that we can later compare:

- application-managed vector retrieval
- managed AWS/Bedrock retrieval
- Redis/ElastiCache vector/hybrid search

Do not commit to a specific vector database without documenting the trade-off.

## Testing

Add tests for:

- unanswered-message detection
- event schemas
- worker idempotency
- webhook persistence
- dashboard API
- AI structured-output validation
- RAG tenant/business isolation
- prompt injection handling

Add evaluation examples for:

- good follow-up
- unsupported price claim
- prompt injection inside customer text
- wrong business knowledge
- irrelevant retrieval

## AWS

Only after local functionality is coherent, build CDK for:

- VPC
- ECR repositories
- ECS cluster/services
- ALB
- SQS + DLQ
- ElastiCache Redis OSS/Valkey as selected
- IAM roles
- CloudWatch logs/metrics
- secrets/configuration

Do not require AWS to run unit tests.

## Working style

Work incrementally:
A. repository/tooling
B. local infrastructure
C. API + persistence
D. event + worker
E. Redis/idempotency
F. dashboard
G. AI service
H. RAG
I. evaluations/observability
J. CDK/AWS

After each phase:

- run tests
- run typecheck
- summarize files changed
- document decisions
- state the next phase

Do not dump a giant codebase in one pass.

If a design decision is genuinely ambiguous, explain the trade-offs before making a consequential choice.

## Definition of success

From a clean checkout, two developers should eventually be able to:

1. start local dependencies,
2. start the three services,
3. seed a demo garage,
4. ingest a fake WhatsApp message,
5. see an at-risk lead in the dashboard,
6. inspect its recovery case,
7. retrieve business knowledge for the case,
8. generate a grounded Hebrew follow-up suggestion,
9. evaluate that AI behavior,
10. and deploy the same service boundaries to AWS.

Start with Phase A only. Inspect the repository before changing anything.
