# Phase 2 Checklist — Real Async Microservice Behavior

Working split for Phase 2 of the [roadmap](roadmap.md). Two tracks, split between
Erez and Segev, plus one seam both of us verify together.

**Exit criteria:** the API and Recovery Worker are independently runnable
processes communicating through a durable queue.

## Track 1 — Transport (Erez)

Swap the Phase 1 Redis-list stand-in (`packages/queue/src/redisQueue.ts`) for
a real durable queue, without breaking the existing `Queue` interface.

- [ ] **SQS adapter** — new `packages/queue/src/sqsQueue.ts` implementing the
      same `Queue` interface (`publish` / `consume` / `stop` / `close`) using
      `@aws-sdk/client-sqs`.
- [ ] **DLQ** — messages that keep failing redrive to a dead-letter queue
      instead of being logged and dropped.
- [ ] **Retries/backoff** — bounded retry with backoff before a message
      either succeeds or falls to the DLQ (SQS visibility timeout + redrive
      policy).
- [ ] Wire `QUEUE_PROVIDER=local|sqs` to actually switch adapters in
      `services/api/src/index.ts` and `services/recovery-worker/src/index.ts`
      (env var already documented in
      [local-development.md](local-development.md), not yet wired).

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

- [ ] **Idempotency hardening + joint test.** `markProcessed()` already
      exists in `packages/queue/src/idempotency.ts` but isn't wired into the
      worker's consume loop yet. Once Track 1's SQS adapter and Track 2's
      health/logging land: fire a duplicate message through the SQS setup on
      purpose, confirm only one recovery case results. This is the seam
      between "does the transport redeliver safely" (Track 1) and "does the
      handler tolerate it" (Track 2/idempotency), so verify it together
      rather than assuming either side alone covers it.

## Notes

- Neither track requires prior AWS experience beyond
  [aws-infrastructure.md](../architecture/aws-infrastructure.md).
- Follow the normal [branching workflow](branching-and-versioning.md) —
  feature branches off `dev`, one PR per coherent chunk (e.g.
  `feature/sqs-queue-adapter`, `feature/dashboard-redis-cache`), not one
  giant Phase 2 branch.
