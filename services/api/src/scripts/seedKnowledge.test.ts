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

  it("has at least two garages with unique keys, and unique document keys and titles per garage", () => {
    expect(garages.length).toBeGreaterThanOrEqual(2);
    expect(new Set(garages.map((g) => g.key)).size).toBe(garages.length);
    for (const garage of garages) {
      const titles = garage.documents.map((d) => d.title);
      const keys = garage.documents.map((d) => d.key);
      expect(new Set(titles).size, `duplicate title in ${garage.key}`).toBe(titles.length);
      expect(new Set(keys).size, `duplicate document key in ${garage.key}`).toBe(keys.length);
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
  const hours = {
    key: "opening-hours",
    type: "faq" as const,
    title: "שעות פתיחה",
    content: "א-ה 08:00-17:00",
  };
  const warranty = {
    key: "warranty",
    type: "policy" as const,
    title: "אחריות",
    content: "12 חודשים",
  };
  const docs = [hours, warranty];

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

  const findByKey = (key: string) =>
    BusinessKnowledgeDocument.findOne({ businessId, "metadata.fixtureKey": key }).lean();

  it("creates documents at version 1, pending, tagged with their fixture key", async () => {
    const result = await upsertKnowledgeDocuments(businessId, docs);
    expect(result).toEqual({ created: 2, updated: 0, unchanged: 0, orphaned: [] });
    expect(await findByKey("warranty")).toMatchObject({
      title: "אחריות",
      version: 1,
      indexStatus: "pending",
      metadata: { fixtureKey: "warranty" },
    });
  });

  it("is idempotent: re-running with the same fixture changes nothing", async () => {
    await upsertKnowledgeDocuments(businessId, docs);
    const result = await upsertKnowledgeDocuments(businessId, docs);
    expect(result).toEqual({ created: 0, updated: 0, unchanged: 2, orphaned: [] });
    expect(await BusinessKnowledgeDocument.countDocuments({ businessId })).toBe(2);
  });

  it("bumps version and resets to pending when content changes", async () => {
    await upsertKnowledgeDocuments(businessId, docs);
    await BusinessKnowledgeDocument.updateMany({ businessId }, { indexStatus: "indexed" });

    const result = await upsertKnowledgeDocuments(businessId, [
      hours,
      { ...warranty, content: "24 חודשים" },
    ]);

    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    expect(await findByKey("warranty")).toMatchObject({
      version: 2,
      indexStatus: "pending",
      content: "24 חודשים",
    });
  });

  it("updates the same document when only its title is renamed (no duplicate)", async () => {
    await upsertKnowledgeDocuments(businessId, docs);
    const result = await upsertKnowledgeDocuments(businessId, [
      hours,
      { ...warranty, title: "אחריות ותיקונים" },
    ]);

    expect(result).toMatchObject({ created: 0, updated: 1, orphaned: [] });
    expect(await BusinessKnowledgeDocument.countDocuments({ businessId })).toBe(2);
    expect(await findByKey("warranty")).toMatchObject({ title: "אחריות ותיקונים", version: 2 });
  });

  it("treats a metadata-only change as a change", async () => {
    await upsertKnowledgeDocuments(businessId, docs);
    const result = await upsertKnowledgeDocuments(businessId, [
      hours,
      { ...warranty, metadata: { source: "price-list-2026" } },
    ]);

    expect(result).toMatchObject({ updated: 1, unchanged: 1 });
    expect(await findByKey("warranty")).toMatchObject({
      version: 2,
      indexStatus: "pending",
      metadata: { source: "price-list-2026", fixtureKey: "warranty" },
    });
  });

  it("adopts a document seeded before keys existed instead of duplicating it", async () => {
    await BusinessKnowledgeDocument.create({
      businessId,
      type: "policy",
      title: "אחריות",
      content: "12 חודשים",
    });

    const result = await upsertKnowledgeDocuments(businessId, docs);

    expect(result).toMatchObject({ created: 1, updated: 1 });
    expect(await BusinessKnowledgeDocument.countDocuments({ businessId })).toBe(2);
    expect(await findByKey("warranty")).toMatchObject({ version: 2 });
  });

  it("reports fixture documents removed from the file without deleting them", async () => {
    await upsertKnowledgeDocuments(businessId, docs);
    const result = await upsertKnowledgeDocuments(businessId, [hours]);

    expect(result.orphaned).toEqual(["אחריות"]);
    expect(await findByKey("warranty")).not.toBeNull();
  });

  it("never touches or reports documents the owner created", async () => {
    await BusinessKnowledgeDocument.create({
      businessId,
      type: "faq",
      title: "חניה",
      content: "יש חניה ליד המוסך",
    });

    const result = await upsertKnowledgeDocuments(businessId, docs);

    expect(result).toEqual({ created: 2, updated: 0, unchanged: 0, orphaned: [] });
    const ownerDoc = await BusinessKnowledgeDocument.findOne({ businessId, title: "חניה" }).lean();
    expect(ownerDoc).toMatchObject({ version: 1, content: "יש חניה ליד המוסך" });
    expect(ownerDoc?.metadata).toBeUndefined();
  });
});
