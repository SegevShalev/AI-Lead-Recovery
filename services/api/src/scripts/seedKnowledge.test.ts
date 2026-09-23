import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectMongo, disconnectMongo, mongoose } from "@ai-lead-recovery/db";
import { BusinessKnowledgeDocument } from "../db/models.js";
import {
  loadEvalQuestionsFixture,
  loadGaragesFixture,
  upsertKnowledgeDocuments,
} from "./seedKnowledge.js";

const MONGODB_URI =
  (process.env.MONGODB_URI ?? "mongodb://localhost:27018/ai-lead-recovery-test") + "-api-seed";

describe("knowledge fixtures", () => {
  const { garages } = loadGaragesFixture();
  const { questions } = loadEvalQuestionsFixture();

  it("has at least two garages with unique keys and unique titles per garage", () => {
    expect(garages.length).toBeGreaterThanOrEqual(2);
    expect(new Set(garages.map((g) => g.key)).size).toBe(garages.length);
    for (const garage of garages) {
      const titles = garage.documents.map((d) => d.title);
      expect(new Set(titles).size, `duplicate title in ${garage.key}`).toBe(titles.length);
    }
  });

  it("gives the garages different brake prices, so a tenant leak is visible", () => {
    const brakeContents = garages.map(
      (g) => g.documents.find((d) => d.title === "החלפת רפידות בלמים")?.content,
    );
    expect(brakeContents.every(Boolean)).toBe(true);
    expect(new Set(brakeContents).size).toBe(garages.length);
  });

  it("every eval question points at a real garage and real document titles", () => {
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    for (const q of questions) {
      const garage = garages.find((g) => g.key === q.garage);
      expect(garage, `${q.id}: unknown garage ${q.garage}`).toBeDefined();
      const titles = garage?.documents.map((d) => d.title) ?? [];
      for (const expected of q.expectedDocumentTitles) {
        expect(titles, `${q.id}: no document "${expected}"`).toContain(expected);
      }
    }
  });

  it("includes questions whose correct answer is no document", () => {
    expect(questions.some((q) => q.expectedDocumentTitles.length === 0)).toBe(true);
  });
});

describe("upsertKnowledgeDocuments", () => {
  const businessId = new mongoose.Types.ObjectId();
  const docs = [
    { type: "faq" as const, title: "שעות פתיחה", content: "א-ה 08:00-17:00" },
    { type: "policy" as const, title: "אחריות", content: "12 חודשים" },
  ];

  beforeAll(async () => {
    await connectMongo(MONGODB_URI);
  });

  beforeEach(async () => {
    await BusinessKnowledgeDocument.deleteMany({});
  });

  afterAll(async () => {
    await BusinessKnowledgeDocument.deleteMany({});
    await disconnectMongo();
  });

  it("creates documents at version 1, pending indexing", async () => {
    const result = await upsertKnowledgeDocuments(businessId, docs);
    expect(result).toEqual({ created: 2, updated: 0, unchanged: 0 });
    const stored = await BusinessKnowledgeDocument.find({ businessId }).lean();
    expect(stored.map((d) => [d.version, d.indexStatus])).toEqual([
      [1, "pending"],
      [1, "pending"],
    ]);
  });

  it("is idempotent: re-running with the same content changes nothing", async () => {
    await upsertKnowledgeDocuments(businessId, docs);
    const result = await upsertKnowledgeDocuments(businessId, docs);
    expect(result).toEqual({ created: 0, updated: 0, unchanged: 2 });
    expect(await BusinessKnowledgeDocument.countDocuments({ businessId })).toBe(2);
  });

  it("bumps version and resets to pending when a fixture's content changes", async () => {
    await upsertKnowledgeDocuments(businessId, docs);
    await BusinessKnowledgeDocument.updateMany({ businessId }, { indexStatus: "indexed" });

    const edited = [docs[0]!, { ...docs[1]!, content: "24 חודשים" }];
    const result = await upsertKnowledgeDocuments(businessId, edited);

    expect(result).toEqual({ created: 0, updated: 1, unchanged: 1 });
    const warranty = await BusinessKnowledgeDocument.findOne({ businessId, title: "אחריות" });
    expect(warranty?.version).toBe(2);
    expect(warranty?.indexStatus).toBe("pending");
    expect(warranty?.content).toBe("24 חודשים");
  });
});
