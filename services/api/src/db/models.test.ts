import { describe, expect, it } from "vitest";
import { mongoose } from "@ai-lead-recovery/db";
import { knowledgeDocumentTypeSchema, knowledgeIndexStatusSchema } from "@ai-lead-recovery/shared";
import { BusinessKnowledgeDocument } from "./models.js";

// validateSync runs Mongoose's own checks without a database connection.
function validate(fields: Record<string, unknown>) {
  return new BusinessKnowledgeDocument({
    businessId: new mongoose.Types.ObjectId(),
    type: "service",
    title: "בלמים",
    content: "450 ₪",
    ...fields,
  }).validateSync();
}

describe("BusinessKnowledgeDocument model", () => {
  it("accepts every type and indexStatus the shared contract accepts", () => {
    for (const type of knowledgeDocumentTypeSchema.options) {
      expect(validate({ type }), type).toBeUndefined();
    }
    for (const indexStatus of knowledgeIndexStatusSchema.options) {
      expect(validate({ indexStatus }), indexStatus).toBeUndefined();
    }
  });

  it("rejects values outside the contract", () => {
    expect(validate({ type: "pizza" })?.errors.type).toBeDefined();
    expect(validate({ indexStatus: "done" })?.errors.indexStatus).toBeDefined();
  });

  it("starts new documents as pending", () => {
    const doc = new BusinessKnowledgeDocument({ type: "faq", title: "t", content: "c" });
    expect(doc.indexStatus).toBe("pending");
  });
});
