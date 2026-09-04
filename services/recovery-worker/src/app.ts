import express, { type Express } from "express";
import { mongoose } from "@ai-lead-recovery/db";

export interface HealthDeps {
  /** Same connection the worker uses for idempotency/cache invalidation. */
  isRedisConnected: () => boolean;
  /** Timestamp of the last event the worker finished handling, or null if none yet. */
  lastEventProcessedAt: () => Date | null;
}

/**
 * What Phase 6's ECS health check will probe (docs/development/phase-2-checklist.md).
 * Readiness requires both DB connections to be up; `lastEventProcessedAt` is
 * reported for observability but doesn't gate readiness — an idle worker with
 * no traffic yet is healthy, not degraded.
 */
export function createApp(deps: HealthDeps): Express {
  const app = express();

  app.get("/health", (_req, res) => {
    const mongoConnected = mongoose.connection.readyState === 1;
    const redisConnected = deps.isRedisConnected();
    const ready = mongoConnected && redisConnected;

    res.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "degraded",
      service: "recovery-worker",
      mongoConnected,
      redisConnected,
      lastEventProcessedAt: deps.lastEventProcessedAt()?.toISOString() ?? null,
    });
  });

  return app;
}
