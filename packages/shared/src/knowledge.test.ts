import { describe, expect, it } from "vitest";
import {
  emptyRetrieval,
  indexDocumentRequestSchema,
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
});
