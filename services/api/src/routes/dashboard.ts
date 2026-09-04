import { Router } from "express";
import { mongoose } from "@ai-lead-recovery/db";
import type { RedisStringClient } from "@ai-lead-recovery/queue";
import { dashboardCacheKey } from "@ai-lead-recovery/shared";
import { RecoveryCase } from "../db/models.js";

interface TypeBreakdown {
  _id: string;
  count: number;
  estimatedValue: number;
}

/** Same narrow redis shape as packages/queue/src/idempotency.ts's RedisStringClient. */
export type DashboardCacheClient = RedisStringClient;

const CACHE_TTL_SECONDS = 30;

/**
 * PRD dashboard headline metric (docs/product/PRD.md section 9):
 * total recoverable value, broken down by recovery-case type.
 * Cached with a short TTL (docs/architecture/service-boundaries.md#redis-usage);
 * recovery-worker deletes the key directly when it opens a new case
 * (see invalidateDashboardCache in services/recovery-worker/src/index.ts).
 * Staleness is usually bounded by whichever comes first, the TTL or that
 * delete — but a request that read Mongo just before the delete can still
 * write its (now-stale) result back after it, so the true bound is TTL plus
 * one in-flight request. Accepted for now given the 30s TTL; a per-key
 * version/lock would close it if this ever needs to be tighter.
 */
export function createDashboardRouter(deps: { cache: DashboardCacheClient }): Router {
  const router = Router();

  router.get("/api/dashboard", async (req, res) => {
    const { businessId } = req.query;
    if (typeof businessId !== "string" || !mongoose.Types.ObjectId.isValid(businessId)) {
      res.status(400).json({ error: "businessId_required" });
      return;
    }

    const cacheKey = dashboardCacheKey(businessId);
    try {
      const cached = await deps.cache.get(cacheKey);
      if (cached) {
        res.json(JSON.parse(cached));
        return;
      }
    } catch (err) {
      console.warn("[api] dashboard cache read failed, falling back to Mongo", err);
    }

    const rows = await RecoveryCase.aggregate<TypeBreakdown>([
      { $match: { businessId: new mongoose.Types.ObjectId(businessId), status: "open" } },
      { $group: { _id: "$type", count: { $sum: 1 }, estimatedValue: { $sum: "$estimatedValue" } } },
    ]);

    const breakdown = Object.fromEntries(
      rows.map((row) => [row._id, { count: row.count, estimatedValue: row.estimatedValue }]),
    );
    const totalRecoverableValue = rows.reduce((sum, row) => sum + row.estimatedValue, 0);
    const body = { totalRecoverableValue, breakdown };

    try {
      await deps.cache.set(cacheKey, JSON.stringify(body), { EX: CACHE_TTL_SECONDS });
    } catch (err) {
      console.warn("[api] dashboard cache write failed", err);
    }
    res.json(body);
  });

  return router;
}
