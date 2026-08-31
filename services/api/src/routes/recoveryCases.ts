import { Router } from "express";
import { mongoose } from "@ai-lead-recovery/db";
import { recoveryCaseStatusSchema } from "@ai-lead-recovery/shared";
import { Message, RecoveryCase } from "../db/models.js";

/**
 * The dashboard drilldown needs "last message" alongside each case
 * (docs/product/PRD.md section 9). Case volume is small in Phase 1, so a
 * per-case lookup is simpler and more readable than an aggregation pipeline;
 * revisit if/when case counts make this a hot path.
 */
async function attachLastMessage<T extends { conversationId: mongoose.Types.ObjectId }>(
  cases: T[],
): Promise<(T & { lastMessage: { text: string; direction: string; occurredAt: Date } | null })[]> {
  return Promise.all(
    cases.map(async (recoveryCase) => {
      const lastMessage = await Message.findOne({ conversationId: recoveryCase.conversationId })
        .sort({ occurredAt: -1 })
        .select("text direction occurredAt")
        .lean();
      return { ...recoveryCase, lastMessage: lastMessage ?? null };
    }),
  );
}

export function createRecoveryCasesRouter(): Router {
  const router = Router();

  router.get("/api/recovery-cases", async (req, res) => {
    const { businessId, status } = req.query;
    if (typeof businessId !== "string" || !mongoose.Types.ObjectId.isValid(businessId)) {
      res.status(400).json({ error: "businessId_required" });
      return;
    }
    const statusFilter = recoveryCaseStatusSchema.safeParse(status);

    const cases = await RecoveryCase.find({
      businessId,
      ...(statusFilter.success ? { status: statusFilter.data } : {}),
    })
      .sort({ detectedAt: -1 })
      .populate("customerId", "displayName phone")
      .lean();

    res.json({ cases: await attachLastMessage(cases) });
  });

  router.get("/api/recovery-cases/:id", async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ error: "recovery_case_not_found" });
      return;
    }

    const recoveryCase = await RecoveryCase.findById(id)
      .populate("customerId", "displayName phone")
      .lean();
    if (!recoveryCase) {
      res.status(404).json({ error: "recovery_case_not_found" });
      return;
    }

    const messages = await Message.find({ conversationId: recoveryCase.conversationId })
      .sort({ occurredAt: 1 })
      .lean();

    res.json({ case: recoveryCase, messages });
  });

  return router;
}
