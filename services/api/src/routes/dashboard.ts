import { Router } from "express";
import { mongoose } from "@ai-lead-recovery/db";
import { RecoveryCase } from "../db/models.js";

interface TypeBreakdown {
  _id: string;
  count: number;
  estimatedValue: number;
}

/**
 * PRD dashboard headline metric (docs/product/PRD.md section 9):
 * total recoverable value, broken down by recovery-case type.
 * Redis caching of this aggregate is a Phase 2 concern; Phase 1 reads
 * MongoDB directly since the exit criterion only needs it correct, not fast.
 */
export function createDashboardRouter(): Router {
  const router = Router();

  router.get("/api/dashboard", async (req, res) => {
    const { businessId } = req.query;
    if (typeof businessId !== "string" || !mongoose.Types.ObjectId.isValid(businessId)) {
      res.status(400).json({ error: "businessId_required" });
      return;
    }

    const rows = await RecoveryCase.aggregate<TypeBreakdown>([
      { $match: { businessId: new mongoose.Types.ObjectId(businessId), status: "open" } },
      { $group: { _id: "$type", count: { $sum: 1 }, estimatedValue: { $sum: "$estimatedValue" } } },
    ]);

    const breakdown = Object.fromEntries(
      rows.map((row) => [row._id, { count: row.count, estimatedValue: row.estimatedValue }]),
    );
    const totalRecoverableValue = rows.reduce((sum, row) => sum + row.estimatedValue, 0);

    res.json({ totalRecoverableValue, breakdown });
  });

  return router;
}
