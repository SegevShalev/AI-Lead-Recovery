/**
 * `pnpm --filter @ai-lead-recovery/ai-service eval:retrieval`
 *
 * Scores retrieval on fixtures/knowledge/eval-questions.json and sweeps
 * RETRIEVAL_TOP_K x RETRIEVAL_MIN_SCORE, so the defaults are chosen from
 * numbers (docs/development/phase-4-track-1-plan.md, Stage 7). Needs no
 * Docker, Mongo or Qdrant: it indexes into a throwaway in-memory store.
 *
 * Only meaningful with EMBEDDING_PROVIDER=openai (costs well under a cent).
 * The mock embedder is lexical and can't match a paraphrase.
 */
import { loadEnv } from "@ai-lead-recovery/config";
import { chunkDocument } from "../knowledge/chunker.js";
import { createEmbedderFromEnv } from "../knowledge/embedderFactory.js";
import { MockEmbedder } from "../knowledge/mockEmbedder.js";
import { fixtureIndexRequests, loadKnowledgeFixtures } from "../eval/fixtures.js";
import {
  type CaseRun,
  judge,
  MIN_SCORE_GRID,
  QUERY_VARIANTS,
  type QueryVariant,
  recommend,
  type RetrievalSettings,
  runRetrievalEval,
  scoreSettings,
  separation,
  sweep,
  type SweepRow,
  TOP_K_GRID,
} from "../eval/retrievalEval.js";

const env = loadEnv();
const embedder = createEmbedderFromEnv(env);
const fixtures = loadKnowledgeFixtures();
const current: RetrievalSettings = {
  topK: env.RETRIEVAL_TOP_K,
  minScore: env.RETRIEVAL_MIN_SCORE,
};

const requests = fixtureIndexRequests(fixtures.garages);
const chunkCount = requests.reduce((sum, request) => sum + chunkDocument(request).length, 0);
const questions = fixtures.questions.questions;
const shouldBeEmpty = questions.filter((q) => q.expectedDocumentTitles.length === 0).length;

console.log(`Retrieval eval · embedder ${embedder.model}`);
console.log(
  `${requests.length} documents (${chunkCount} chunks) in ${fixtures.garages.garages.length} garages · ` +
    `${questions.length} questions (${questions.length - shouldBeEmpty} with an answer, ` +
    `${shouldBeEmpty} that should return nothing)`,
);
console.log(
  `Current settings: RETRIEVAL_TOP_K=${current.topK} RETRIEVAL_MIN_SCORE=${current.minScore}`,
);
if (embedder instanceof MockEmbedder) {
  console.log(
    "\n⚠  Mock embedder: it only matches shared words, so these numbers can't be used for tuning.\n" +
      "   Run with EMBEDDING_PROVIDER=openai and EMBEDDING_API_KEY set.",
  );
}

try {
  for (const variant of Object.keys(QUERY_VARIANTS) as QueryVariant[]) {
    const runs = await runRetrievalEval(embedder, fixtures, variant);
    printVariant(variant, runs);
  }
} catch (error) {
  console.error(`\neval failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

function printVariant(variant: QueryVariant, runs: CaseRun[]): void {
  console.log(`\n=== Query: ${variant} ===\n`);
  console.log("Per question at the current settings (score = cosine; top 5, no threshold):");
  console.log(
    `${"question".padEnd(30)} ${"expected".padEnd(18)} ${"outcome".padEnd(14)} ` +
      `${"rank".padStart(4)} ${"score".padStart(6)} ${"best other".padStart(10)}`,
  );
  for (const run of runs) {
    const { outcome } = judge(run, current);
    const { expectedRank, expectedScore, bestOtherScore } = separation(run);
    console.log(
      `${run.evalCase.id.padEnd(30)} ${(run.evalCase.expectedDocumentIds.join(",") || "(nothing)").padEnd(18)} ` +
        `${outcome.padEnd(14)} ${String(expectedRank ?? "-").padStart(4)} ` +
        `${formatScore(expectedScore).padStart(6)} ${formatScore(bestOtherScore).padStart(10)}`,
    );
  }
  console.log(`\nTotals at the current settings: ${formatRow(scoreSettings(runs, current))}`);

  const rows = sweep(runs);
  console.log(
    `\nSweep: questions correct out of ${runs.length} (m = misses, n = noise on "should return nothing")`,
  );
  console.log(["minScore", ...TOP_K_GRID.map((k) => `k=${k}`)].map((h) => h.padEnd(12)).join(""));
  for (const minScore of MIN_SCORE_GRID) {
    const cells = TOP_K_GRID.map((topK) => {
      const row = rows.find((r) => r.topK === topK && r.minScore === minScore)!;
      return `${row.correct} m${row.misses} n${row.noise}`.padEnd(12);
    });
    console.log(minScore.toFixed(2).padEnd(12) + cells.join(""));
  }

  const { row, band } = recommend(rows);
  console.log(
    `\nSuggested: RETRIEVAL_TOP_K=${row.topK} RETRIEVAL_MIN_SCORE=${row.minScore.toFixed(2)} ` +
      `(minScore ${band.from.toFixed(2)}–${band.to.toFixed(2)} ties; middle picked) → ${formatRow(row)}`,
  );
}

function formatRow(row: SweepRow): string {
  return (
    `${row.correct}/${row.total} correct · ${row.hits} hits, ${row.misses} misses, ` +
    `${row.correctEmpty} correctly empty, ${row.noise} noise · ${row.returnedChunks} chunks returned`
  );
}

function formatScore(score: number | undefined): string {
  return score === undefined ? "-" : score.toFixed(3);
}
