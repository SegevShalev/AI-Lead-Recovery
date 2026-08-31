import { Router } from "express";
import { Business } from "../db/models.js";

/**
 * Phase 1 is single-tenant-per-session (no auth/business-switching yet), so
 * the dashboard just needs to discover the seeded demo business's id — this
 * avoids hardcoding it into the frontend build.
 */
export function createBusinessesRouter(): Router {
  const router = Router();

  router.get("/api/businesses", async (_req, res) => {
    const businesses = await Business.find().select("name vertical").lean();
    res.json({ businesses });
  });

  return router;
}
