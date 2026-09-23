import { describe, expect, it } from "vitest";
import type { KnowledgeDocument, SuggestionOutcome } from "./api.js";
import { groupByType, knowledgeBasis } from "./knowledge.js";

type OkOutcome = Extract<SuggestionOutcome, { status: "ok" }>;

function outcome(overrides: Partial<OkOutcome>): OkOutcome {
  return {
    status: "ok",
    suggestionId: "s1",
    message: "היי",
    reason: "quote sent, no reply",
    language: "he",
    model: "mock",
    promptVersion: "hebrew-followup-v1",
    generatedAt: new Date().toISOString(),
    retrieval: { status: "empty" },
    knowledgeDocuments: [],
    ...overrides,
  };
}

function doc(type: KnowledgeDocument["type"], title: string): KnowledgeDocument {
  return {
    _id: title,
    businessId: "b1",
    type,
    title,
    content: "x",
    version: 1,
    indexStatus: "indexed",
    updatedAt: new Date().toISOString(),
  };
}

describe("knowledgeBasis", () => {
  it("lists the titles the suggestion was based on", () => {
    const basis = knowledgeBasis(
      outcome({
        retrieval: { status: "used" },
        knowledgeDocuments: [
          { documentId: "1", title: "בלמים" },
          { documentId: "2", title: "אחריות" },
        ],
      }),
    );
    expect(basis).toEqual({ tone: "used", text: "Based on: בלמים, אחריות" });
  });

  it("says no knowledge was used when retrieval found nothing", () => {
    expect(knowledgeBasis(outcome({}))).toEqual({
      tone: "none",
      text: "No business knowledge used",
    });
  });

  it("treats 'used' with no resolvable documents as none", () => {
    expect(knowledgeBasis(outcome({ retrieval: { status: "used" } })).tone).toBe("none");
  });

  it("warns the reviewer when retrieval failed", () => {
    const basis = knowledgeBasis(outcome({ retrieval: { status: "failed" } }));
    expect(basis.tone).toBe("failed");
    expect(basis.text).toMatch(/without your prices or policies/);
  });
});

describe("groupByType", () => {
  it("orders groups by a fixed type order, drops empty ones, and sorts titles", () => {
    const groups = groupByType([
      doc("faq", "שעות פתיחה"),
      doc("service", "תיקון פנצ'רים"),
      doc("service", "החלפת שמן"),
    ]);
    expect(groups.map((g) => g.type)).toEqual(["service", "faq"]);
    expect(groups[0]?.documents.map((d) => d.title)).toEqual(["החלפת שמן", "תיקון פנצ'רים"]);
  });
});
