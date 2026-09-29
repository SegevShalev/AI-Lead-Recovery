import { describe, expect, it } from "vitest";
import { type Embedder, EmbeddingError } from "../knowledge/embedder.js";
import { MockEmbedder } from "../knowledge/mockEmbedder.js";
import { chunkPointId } from "../knowledge/vectorStore.js";
import { buildHebrewFollowupPrompt } from "../prompts.js";
import type { SuggestionProvider } from "../providers/types.js";
import {
  allFixtureChunks,
  type CaseResult,
  expectedFacts,
  runComparison,
  scoreAnswer,
  summarize,
} from "./compareEval.js";
import { loadKnowledgeFixtures, resolveEvalCases } from "./fixtures.js";

const fixtures = loadKnowledgeFixtures();
const cases = resolveEvalCases(fixtures);
const caseById = (id: string) => cases.find((c) => c.id === id)!;

/**
 * Stands in for a model: quotes the first price in the knowledge it was
 * shown, or promises to check when it was shown none.
 */
const quotesFirstPrice: SuggestionProvider = {
  name: "quotes-first-price",
  generate: async (input) => {
    const { user } = buildHebrewFollowupPrompt(input);
    const knowledge = user.slice(
      user.indexOf("<business_knowledge>"),
      user.indexOf("</business_knowledge>"),
    );
    const price = knowledge.match(/(\d[\d,]*) ₪/)?.[1];
    return {
      output: {
        message: price ? `היי דנה, המחיר ${price} ₪.` : "היי דנה, נבדוק ונחזור אלייך.",
        reason: "test",
      },
      usage: { inputTokens: 1_000, outputTokens: 50 },
    };
  },
};

describe("expectedFacts", () => {
  it("is the numbers in the question's right document", () => {
    expect(expectedFacts(caseById("north-brakes-direct"), fixtures.garages)).toEqual([
      "450",
      "900",
    ]);
    expect(expectedFacts(caseById("south-brakes-direct"), fixtures.garages)).toEqual([
      "520",
      "1050",
    ]);
  });

  it("is empty when the right document has no numbers, or there is none", () => {
    // North's appointments doc: "by appointment only" - no numbers to check.
    expect(expectedFacts(caseById("north-walk-in"), fixtures.garages)).toEqual([]);
    expect(expectedFacts(caseById("north-off-topic"), fixtures.garages)).toEqual([]);
  });
});

describe("scoreAnswer", () => {
  it("counts the expected facts the message states", () => {
    expect(scoreAnswer("רפידות: 450 ₪", ["450", "900"], "כמה עולה?")).toEqual({
      degraded: false,
      expected: ["450", "900"],
      stated: ["450"],
      other: [],
    });
  });

  it("flags numbers from a wrong document, but not numbers from the question", () => {
    const score = scoreAnswer("טיפול 10 אלף: 280 ₪", ["10000", "650"], "הגעתי ל-10 אלף קילומטר");
    expect(score.stated).toEqual(["10000"]);
    expect(score.other).toEqual(["280"]);
  });

  it("marks a degraded suggestion", () => {
    expect(scoreAnswer(undefined, ["450"], "?")).toMatchObject({ degraded: true, stated: [] });
  });
});

describe("allFixtureChunks", () => {
  it("chunks every fixture document with the indexer's point ids", () => {
    const chunks = allFixtureChunks(fixtures.garages);
    const total = [...chunks.values()].reduce((n, list) => n + list.length, 0);
    const documents = fixtures.garages.garages.reduce((n, g) => n + g.documents.length, 0);
    expect(total).toBe(documents); // every fixture document is one short chunk
    const brakes = chunks.get("fixture-north")!.find((c) => c.documentId === "brakes")!;
    expect(brakes.chunkId).toBe(chunkPointId("fixture-north", "brakes", 0));
    expect(chunks.get("fixture-north")!.every((c) => c.businessId === "fixture-north")).toBe(true);
  });
});

describe("runComparison", () => {
  it("runs every question through every mode with the production generator", async () => {
    const seen: CaseResult[] = [];
    const results = await runComparison({
      fixtures,
      provider: quotesFirstPrice,
      embedder: new MockEmbedder(),
      retrieval: { topK: 5, minScore: 0.2 },
      onResult: (result) => seen.push(result),
    });

    expect(results).toHaveLength(cases.length * 3);
    expect(seen).toEqual(results);

    const none = summarize("no knowledge", results);
    const all = summarize("all knowledge", results);
    const rag = summarize("rag", results);

    // No knowledge: nothing shown, nothing stated.
    expect(none).toMatchObject({ rightDocumentShown: 0, answered: 0, otherNumbers: 0 });
    // All knowledge: the right document is always there...
    expect(all.rightDocumentShown).toBe(all.answerable);
    // ...but this "model" quotes the first price it sees (brakes) for every
    // question - grounded, yet from the wrong document. That's "other numbers".
    expect(all.otherNumbers).toBeGreaterThan(0);
    const allOil = results.find(
      (r) => r.mode === "all knowledge" && r.evalCase.id === "north-oil",
    )!;
    expect(allOil.score).toMatchObject({ stated: [], other: ["450"] });
    // RAG puts the brakes chunk first for the brakes question.
    const ragBrakes = results.find(
      (r) => r.mode === "rag" && r.evalCase.id === "north-brakes-direct",
    )!;
    expect(ragBrakes.score.stated).toEqual(["450"]);
    expect(rag.rightDocumentShown).toBeGreaterThan(0);
    // Tokens are summed from what the provider reported.
    expect(rag).toMatchObject({ attempts: cases.length, inputTokens: cases.length * 1_000 });
  });

  it("stops when rag retrieval fails, instead of scoring it as no knowledge", async () => {
    let calls = 0;
    const failsOnQuestions: Embedder = {
      model: "flaky",
      dimensions: 256,
      async embed(texts) {
        const documents = fixtures.garages.garages.reduce((n, g) => n + g.documents.length, 0);
        if (++calls > documents) throw new EmbeddingError("down", "unavailable", true);
        return new MockEmbedder().embed(texts);
      },
    };

    await expect(
      runComparison({
        fixtures,
        provider: quotesFirstPrice,
        embedder: failsOnQuestions,
        retrieval: { topK: 5, minScore: 0.2 },
        modes: ["rag"],
      }),
    ).rejects.toThrow(/retrieval failed/);
  });
});
