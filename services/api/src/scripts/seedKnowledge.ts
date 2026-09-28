import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  evalQuestionsFixtureSchema,
  garagesFixtureSchema,
  type EvalQuestionsFixture,
  type FixtureDocument,
  type GarageFixture,
  type GaragesFixture,
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
  /** Titles of seeded documents whose key is no longer in the fixture — reported, never deleted. */
  orphaned: string[];
}

/**
 * Idempotent. A seeded document is identified by its fixture `key`, stored as
 * `metadata.fixtureKey`, so editing a title in garages.json updates the same
 * document instead of creating a second one. Any change (title, type,
 * content or metadata) bumps `version` and resets `indexStatus` to
 * "pending", the same thing an owner's edit does; an unchanged document is
 * left alone.
 *
 * Documents without a fixtureKey were created by the owner (or by a seed from
 * before keys existed, matched once by title and adopted). The seed never
 * touches owner documents. Fixture documents that disappeared from the file
 * are only reported: deleting them here, in Mongo only, would leave their
 * chunks in the AI index — delete them from the dashboard instead.
 */
export async function upsertKnowledgeDocuments(
  businessId: mongoose.Types.ObjectId,
  documents: FixtureDocument[],
): Promise<KnowledgeSeedResult> {
  const result: KnowledgeSeedResult = { created: 0, updated: 0, unchanged: 0, orphaned: [] };

  for (const { key, ...doc } of documents) {
    const metadata = { ...doc.metadata, fixtureKey: key };
    const existing =
      (await BusinessKnowledgeDocument.findOne({ businessId, "metadata.fixtureKey": key })) ??
      (await BusinessKnowledgeDocument.findOne({
        businessId,
        title: doc.title,
        "metadata.fixtureKey": { $exists: false },
      }));

    if (!existing) {
      await BusinessKnowledgeDocument.create({ businessId, ...doc, metadata });
      result.created++;
      continue;
    }

    const changed =
      existing.title !== doc.title ||
      existing.type !== doc.type ||
      existing.content !== doc.content ||
      !isDeepStrictEqual(existing.metadata ?? {}, metadata);
    if (!changed) {
      result.unchanged++;
      continue;
    }

    existing.title = doc.title;
    existing.type = doc.type;
    existing.content = doc.content;
    existing.metadata = metadata;
    existing.version += 1;
    existing.indexStatus = "pending";
    await existing.save();
    result.updated++;
  }

  const orphans = await BusinessKnowledgeDocument.find({
    businessId,
    "metadata.fixtureKey": { $exists: true, $nin: documents.map((doc) => doc.key) },
  })
    .select("title")
    .lean();
  result.orphaned = orphans.map((doc) => doc.title);

  return result;
}
