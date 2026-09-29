import { describe, expect, it } from "vitest";
import { type Embedder, EmbeddingError } from "../knowledge/embedder.js";
import { MockEmbedder } from "../knowledge/mockEmbedder.js";
import {
  type EvalCase,
  fixtureBusinessId,
  fixtureIndexRequests,
  type KnowledgeFixtures,
  loadKnowledgeFixtures,
  resolveEvalCases,
} from "./fixtures.js";
import {
  type CaseRun,
  judge,
  MIN_SCORE_GRID,
  recommend,
  runRetrievalEval,
  scoreSettings,
  separation,
  sweep,
  type SweepRow,
} from "./retrievalEval.js";

function run(expectedDocumentIds: string[], ranked: [string, number][]): CaseRun {
  const evalCase: EvalCase = {
    id: "q",
    businessId: "fixture-north",
    question: "?",
    expectedDocumentIds,
  };
  return { evalCase, ranked: ranked.map(([documentId, score]) => ({ documentId, score })) };
}

describe("judge", () => {
  const brakes = run(
    ["brakes"],
    [
      ["hours", 0.5],
      ["brakes", 0.4],
      ["oil", 0.1],
    ],
  );

  it("is a hit when an expected document is within k and above the threshold", () => {
    expect(judge(brakes, { topK: 2, minScore: 0.3 }).outcome).toBe("hit");
  });

  it("is a miss when the expected document is past k", () => {
    const { outcome, returned } = judge(brakes, { topK: 1, minScore: 0 });
    expect(outcome).toBe("miss");
    expect(returned.map((hit) => hit.documentId)).toEqual(["hours"]);
  });

  it("is a miss when the expected document is below the threshold", () => {
    expect(judge(brakes, { topK: 5, minScore: 0.45 }).outcome).toBe("miss");
  });

  it("counts a score exactly at the threshold as returned, like the stores do", () => {
    expect(judge(brakes, { topK: 5, minScore: 0.4 }).outcome).toBe("hit");
  });

  it("is correct_empty / noise for a question that should return nothing", () => {
    const offTopic = run([], [["hours", 0.3]]);
    expect(judge(offTopic, { topK: 5, minScore: 0.35 }).outcome).toBe("correct_empty");
    expect(judge(offTopic, { topK: 5, minScore: 0.25 }).outcome).toBe("noise");
  });
});

describe("separation", () => {
  it("reports the expected document's rank and score and the best wrong score", () => {
    expect(
      separation(
        run(
          ["brakes"],
          [
            ["hours", 0.5],
            ["brakes", 0.4],
          ],
        ),
      ),
    ).toEqual({
      expectedRank: 2,
      expectedScore: 0.4,
      bestOtherScore: 0.5,
    });
  });

  it("leaves out what isn't there", () => {
    expect(separation(run(["brakes"], [["hours", 0.5]]))).toEqual({ bestOtherScore: 0.5 });
    expect(separation(run([], []))).toEqual({});
  });
});

describe("scoreSettings", () => {
  it("counts every outcome and the returned chunks", () => {
    const runs = [
      run(
        ["brakes"],
        [
          ["brakes", 0.6],
          ["oil", 0.2],
        ],
      ), // hit, 1 chunk returned at 0.3
      run(["oil"], [["brakes", 0.5]]), // miss, 1 chunk
      run([], [["hours", 0.1]]), // correct_empty, 0 chunks
      run([], [["hours", 0.4]]), // noise, 1 chunk
    ];
    expect(scoreSettings(runs, { topK: 5, minScore: 0.3 })).toEqual({
      topK: 5,
      minScore: 0.3,
      hits: 1,
      misses: 1,
      correctEmpty: 1,
      noise: 1,
      correct: 2,
      total: 4,
      returnedChunks: 3,
    });
  });
});

describe("sweep", () => {
  it("scores every (k, minScore) pair, with exact grid values", () => {
    const rows = sweep([run(["brakes"], [["brakes", 0.5]])], [1, 2], [0, 0.3]);
    expect(rows.map((row) => [row.topK, row.minScore])).toEqual([
      [1, 0],
      [1, 0.3],
      [2, 0],
      [2, 0.3],
    ]);
    expect(MIN_SCORE_GRID).toContain(0.3);
    expect(MIN_SCORE_GRID[MIN_SCORE_GRID.length - 1]).toBe(0.8);
  });
});

describe("recommend", () => {
  const row = (topK: number, minScore: number, correct: number, misses: number): SweepRow => ({
    topK,
    minScore,
    correct,
    misses,
    hits: correct,
    correctEmpty: 0,
    noise: 0,
    total: 18,
    returnedChunks: 0,
  });

  it("picks the most correct row", () => {
    expect(recommend([row(1, 0.2, 10, 0), row(1, 0.3, 12, 0)]).row.minScore).toBe(0.3);
  });

  it("breaks a tie on correct by fewer misses", () => {
    expect(recommend([row(1, 0.2, 12, 2), row(1, 0.4, 12, 0)]).row.minScore).toBe(0.4);
  });

  it("then prefers the smallest k", () => {
    expect(recommend([row(3, 0.3, 12, 0), row(2, 0.3, 12, 0)]).row.topK).toBe(2);
  });

  it("then picks the middle of the tied minScore band, not its edge", () => {
    const result = recommend([
      row(1, 0.2, 12, 0),
      row(1, 0.25, 12, 0),
      row(1, 0.3, 12, 0),
      row(1, 0.35, 11, 1),
    ]);
    expect(result.row.minScore).toBe(0.25);
    expect(result.band).toEqual({ from: 0.2, to: 0.3 });
  });
});

describe("fixtures", () => {
  const fixtures = loadKnowledgeFixtures();

  it("resolves every question's expected titles to document keys in its own garage", () => {
    const cases = resolveEvalCases(fixtures);
    expect(cases).toHaveLength(fixtures.questions.questions.length);
    expect(cases.find((c) => c.id === "north-brakes-direct")).toMatchObject({
      businessId: fixtureBusinessId("north"),
      expectedDocumentIds: ["brakes"],
    });
    // Only south has a puncture document; for north the right answer is nothing.
    expect(cases.find((c) => c.id === "north-puncture-other-garage")!.expectedDocumentIds).toEqual(
      [],
    );
  });

  it("rejects a question whose expected title isn't in its garage", () => {
    const broken: KnowledgeFixtures = {
      ...fixtures,
      questions: {
        questions: [
          { id: "bad", garage: "north", question: "?", expectedDocumentTitles: ["תיקון פנצ'רים"] },
        ],
      },
    };
    expect(() => resolveEvalCases(broken)).toThrow(/no document titled/);
  });

  it("builds one index request per fixture document, scoped to its garage", () => {
    const requests = fixtureIndexRequests(fixtures.garages);
    const documentCount = fixtures.garages.garages.reduce((n, g) => n + g.documents.length, 0);
    expect(requests).toHaveLength(documentCount);
    expect(new Set(requests.map((r) => r.businessId))).toEqual(
      new Set(["fixture-north", "fixture-south"]),
    );
  });
});

describe("runRetrievalEval", () => {
  const fixtures = loadKnowledgeFixtures();

  it("ranks every question's top 5 within its own garage, best first", async () => {
    const runs = await runRetrievalEval(new MockEmbedder(), fixtures, "reason + message");
    expect(runs).toHaveLength(fixtures.questions.questions.length);
    for (const { ranked } of runs) {
      expect(ranked.length).toBeLessThanOrEqual(5);
      const scores = ranked.map((hit) => hit.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
    // Only south has a puncture document, so north can never rank it.
    const north = runs.filter((r) => r.evalCase.businessId === "fixture-north");
    expect(north.flatMap((r) => r.ranked).some((hit) => hit.documentId === "punctures")).toBe(
      false,
    );
    // Same words as the document, so even the lexical mock ranks it first.
    const direct = runs.find((r) => r.evalCase.id === "north-brakes-direct")!;
    expect(direct.ranked[0]!.documentId).toBe("brakes");
  });

  it("stops instead of scoring an embedding outage as misses", async () => {
    let calls = 0;
    const failsOnQuestions: Embedder = {
      model: "flaky",
      dimensions: 256,
      async embed(texts) {
        // Indexing (one call per document) works; the first question fails.
        if (++calls > fixtureIndexRequests(fixtures.garages).length) {
          throw new EmbeddingError("down", "unavailable", true);
        }
        return new MockEmbedder().embed(texts);
      },
    };
    await expect(runRetrievalEval(failsOnQuestions, fixtures, "message only")).rejects.toThrow(
      /retrieval failed/,
    );
  });
});
