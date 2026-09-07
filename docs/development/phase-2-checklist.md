# Phase 2 Checklist — Real Async Microservice Behavior

Working split for Phase 2 of the [roadmap](roadmap.md). Two tracks, split between
Erez and Segev, plus one seam both of us verify together.

**Exit criteria:** the API and Recovery Worker are independently runnable
processes communicating through a durable queue.

## Track 1 — Transport (Erez)

Swap the Phase 1 Redis-list stand-in (`packages/queue/src/redisQueue.ts`) for
a real durable queue, without breaking the existing `Queue` interface.

- [x] **SQS adapter** — `packages/queue/src/sqsQueue.ts` implements the same
      `Queue` interface (`publish` / `consume` / `stop` / `close`) using
      `@aws-sdk/client-sqs`. Return type is explicitly annotated `: Queue` so
      the compiler enforces the contract match with `redisQueue.ts`.
- [x] **Retries (app side)** — `consume` only calls `DeleteMessageCommand`
      after the handler succeeds; a thrown error leaves the message alone so
      SQS redelivers it after the visibility timeout. Covered by
      `sqsQueue.test.ts`.
- [ ] **DLQ + backoff (infra side)** — the actual dead-letter queue and
      `maxReceiveCount`/visibility-timeout backoff are **queue configuration,
      not app code** — they need a real SQS queue with a redrive policy.
      That provisioning is CDK's job (Phase 6 in the roadmap). Until then,
      Track 1 needs _some_ dev/test SQS queue + DLQ to point
      `SQS_QUEUE_URL` at for manual verification — needs an AWS account,
      not something to script unattended.
- [x] Wire `QUEUE_PROVIDER=local|sqs` to actually switch adapters — both
      `services/api/src/index.ts` and `services/recovery-worker/src/index.ts`
      now call `createQueueFromEnv(env, "conversation-events")`
      (`packages/queue/src/createQueueFromEnv.ts`), replacing the old
      "not implemented until Phase 2" guard. `AWS_REGION` added to
      `envSchema` (`packages/config/src/env.ts`); `SQS_QUEUE_URL` +
      `AWS_REGION` are required together when `QUEUE_PROVIDER=sqs`
      (zod `.refine`).

## Track 2 — Visibility + caching (Segev)

Doesn't touch the queue transport at all.

- [ ] **Correlation IDs** — stamp/propagate `correlationId`
      (already an optional field on `eventEnvelopeSchema` in
      `packages/shared/src/events.ts`) on every log line for a given message,
      across both processes.
- [ ] **Worker health check** — a liveness/readiness signal for
      `services/recovery-worker` (e.g. "queue connection alive, last poll
      recent") — also what Phase 6's ECS health checks will depend on.
- [ ] **Redis dashboard caching** — cache `services/api/src/routes/dashboard.ts`
      aggregate reads with a TTL, invalidate on write. Redis usage guidance:
      [service-boundaries.md](../architecture/service-boundaries.md#redis-usage).

## Shared — do together, not split

- [x] **Idempotency wiring** — `worker.ts`'s `handleConversationMessageReceived`
      calls `markProcessed()` first thing and returns early on a duplicate
      `eventId`. Originally this PR left the mark in place even when the
      handler's work then failed, which meant an SQS redelivery would be
      swallowed silently instead of actually reprocessed (caught in review —
      see PR #3). Fixed: the work is wrapped in a try/catch, and a failure
      calls `unmarkProcessed()` to roll back the claim before rethrowing, so
      a redelivery is treated as a fresh first delivery.
- [ ] **Joint test against real SQS.** Once a dev SQS queue exists (see DLQ
      note above) and Track 2's logging/health land: fire a duplicate message
      through it on purpose, confirm only one recovery case results end to
      end. This is the seam between "does the transport redeliver safely"
      (Track 1) and "does the handler tolerate it" (idempotency) — worth
      doing together rather than assuming either side alone covers it.

## Notes

- Neither track requires prior AWS experience beyond
  [aws-infrastructure.md](../architecture/aws-infrastructure.md).
- Follow the normal [branching workflow](branching-and-versioning.md) —
  feature branches off `dev`, one PR per coherent chunk (e.g.
  `feature/sqs-queue-adapter`, `feature/dashboard-redis-cache`), not one
  giant Phase 2 branch.
