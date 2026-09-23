import { describe, expect, it } from "vitest";
import {
  emptyRetrieval,
  indexDocumentRequestSchema,
  knowledgeDocumentInputSchema,
  retrievalInfoSchema,
  suggestionResultSchema,
} from "./index.js";

const validIndexRequest = {
  businessId: "business-1",
  documentId: "doc-1",
  version: 1,
  type: "service",
  title: "מחירון",
  content: "החלפת רפידות בלמים - 450 ש״ח",
};

describe("knowledge contracts", () => {
  it("validates an index request", () => {
    expect(indexDocumentRequestSchema.safeParse(validIndexRequest).success).toBe(true);
  });

  it("rejects an index request with a non-positive version", () => {
    const result = indexDocumentRequestSchema.safeParse({ ...validIndexRequest, version: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects an index request over the content limit", () => {
    const result = indexDocumentRequestSchema.safeParse({
      ...validIndexRequest,
      content: "x".repeat(20_001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 5 retrieval sources", () => {
    const source = { documentId: "doc-1", version: 1, chunkId: "chunk-1", score: 0.8 };
    const result = retrievalInfoSchema.safeParse({
      status: "used",
      sources: Array.from({ length: 6 }, () => source),
      contextVersion: "abc",
    });
    expect(result.success).toBe(false);
  });

  it("requires retrieval on an ok suggestion result", () => {
    const base = {
      status: "ok",
      message: "היי",
      language: "he",
      reason: "quote sent, no reply",
      model: "mock",
      promptVersion: "hebrew-followup-v1",
      generatedAt: new Date().toISOString(),
    };
    expect(suggestionResultSchema.safeParse(base).success).toBe(false);
    expect(suggestionResultSchema.safeParse({ ...base, retrieval: emptyRetrieval }).success).toBe(
      true,
    );
  });

  it("trims and accepts a valid knowledge document input", () => {
    const result = knowledgeDocumentInputSchema.safeParse({
      type: "policy",
      title: "  אחריות  ",
      content: "אחריות של 6 חודשים על חלקים",
    });
    expect(result.success && result.data.title).toBe("אחריות");
  });

  it("rejects knowledge document input with a blank title or unknown type", () => {
    const base = { type: "faq", title: "שעות פתיחה", content: "א-ה 8:00-17:00" };
    expect(knowledgeDocumentInputSchema.safeParse({ ...base, title: "   " }).success).toBe(false);
    expect(knowledgeDocumentInputSchema.safeParse({ ...base, type: "pizza" }).success).toBe(false);
  });

  it("ignores server-owned fields sent by the client", () => {
    const result = knowledgeDocumentInputSchema.safeParse({
      type: "faq",
      title: "שעות פתיחה",
      content: "א-ה 8:00-17:00",
      version: 99,
      indexStatus: "indexed",
    });
    expect(result.success && result.data).not.toHaveProperty("version");
    expect(result.success && result.data).not.toHaveProperty("indexStatus");
  });
});
