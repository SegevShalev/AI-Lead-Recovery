import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  evalQuestionsFixtureSchema,
  garagesFixtureSchema,
  type EvalQuestionsFixture,
  type GarageFixture,
  type GaragesFixture,
  type KnowledgeDocumentInput,
} from "@ai-lead-recovery/shared";
import type { mongoose } from "@ai-lead-recovery/db";
import { Business, BusinessKnowledgeDocument } from "../db/models.js";

/** Repo-level fixtures shared with the ai-service eval runner — see fixtures/knowledge/README.md. */
const FIXTURES_DIR = fileURLToPath(new URL("../../../../fixtures/knowledge/", import.meta.url));

function readJson(fileName: string): unknown {
  return JSON.parse(readFileSync(FIXTURES_DIR + fileName, "utf8"));
}

export function loadGaragesFixture(): GaragesFixture {
  return garagesFixtureSchema.parse(readJson("garages.json"));
}

export function loadEvalQuestionsFixture(): EvalQuestionsFixture {
  return evalQuestionsFixtureSchema.parse(readJson("eval-questions.json"));
}

/** Finds the garage's business by name, creating it on first seed. Returns its id. */
export async function ensureGarageBusiness(
  garage: GarageFixture,
): Promise<mongoose.Types.ObjectId> {
  const existing = await Business.findOne({ name: garage.name });
  if (existing) return existing._id;
  const created = await Business.create({
    name: garage.name,
    vertical: "garage",
    currency: "ILS",
    averageTicketValue: 500 + Math.floor(Math.random() * 20) * 50, // 500-1450, in steps of 50
    settingsVersion: 1,
  });
  return created._id;
}

export interface KnowledgeSeedResult {
  created: number;
  updated: number;
  unchanged: number;
}

/**
 * Idempotent: documents are matched by (businessId, title). Re-running the
 * seed leaves unchanged documents alone (no version bump); an edited fixture
 * bumps `version` and resets `indexStatus` to "pending", the same thing an
 * owner's edit does.
 */
export async function upsertKnowledgeDocuments(
  businessId: mongoose.Types.ObjectId,
  documents: KnowledgeDocumentInput[],
): Promise<KnowledgeSeedResult> {
  const result: KnowledgeSeedResult = { created: 0, updated: 0, unchanged: 0 };

  for (const doc of documents) {
    const existing = await BusinessKnowledgeDocument.findOne({ businessId, title: doc.title });
    if (!existing) {
      await BusinessKnowledgeDocument.create({ businessId, ...doc });
      result.created++;
    } else if (existing.content !== doc.content || existing.type !== doc.type) {
      existing.type = doc.type;
      existing.content = doc.content;
      existing.version += 1;
      existing.indexStatus = "pending";
      await existing.save();
      result.updated++;
    } else {
      result.unchanged++;
    }
  }

  return result;
}
