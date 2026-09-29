import type { Logger, SuggestionRequest } from "@ai-lead-recovery/shared";
import type { Embedder } from "../knowledge/embedder.js";
import { InMemoryVectorStore } from "../knowledge/inMemoryVectorStore.js";
import { KnowledgeIndexer } from "../knowledge/knowledgeIndexer.js";
import { KnowledgeRetriever } from "../knowledge/retriever.js";
import {
  type EvalCase,
  fixtureIndexRequests,
  type KnowledgeFixtures,
  resolveEvalCases,
} from "./fixtures.js";

/**
 * The most chunks a suggestion can carry (the contract's `sources` cap), so
 * the most the eval ever needs to rank.
 */
export const MAX_TOP_K = 5;

/** Same text the Recovery Worker writes (services/recovery-worker/src/rules/unanswered.ts). */
const EVAL_CASE_REASON = "no reply within 60 minutes";

/**
 * Query experiment (plan Stage 7): the case reason is an English system
 * string with no topic in it, so it may only dilute the customer's question.
 * Both variants go through the production `buildRetrievalQuery`.
 */
export const QUERY_VARIANTS = {
  "reason + message": EVAL_CASE_REASON,
  "message only": "",
} as const;
export type QueryVariant = keyof typeof QUERY_VARIANTS;

/** One ranked chunk, best first. No threshold applied yet. */
export interface RankedHit {
  documentId: string;
  score: number;
}

export interface CaseRun {
  evalCase: EvalCase;
  ranked: RankedHit[];
}

export interface RetrievalSettings {
  topK: number;
  minScore: number;
}

/**
 * - hit: an expected document came back
 * - miss: a question with an answer, but no expected document came back
 * - correct_empty: nothing should come back, and nothing did
 * - noise: nothing should come back, but something did
 */
export type Outcome = "hit" | "miss" | "correct_empty" | "noise";

/** What production would return with these settings, and whether that's right. */
export function judge(
  run: CaseRun,
  settings: RetrievalSettings,
): { outcome: Outcome; returned: RankedHit[] } {
  const returned = run.ranked
    .filter((hit) => hit.score >= settings.minScore)
    .slice(0, settings.topK);
  const expected = run.evalCase.expectedDocumentIds;
  if (expected.length === 0) {
    return { outcome: returned.length === 0 ? "correct_empty" : "noise", returned };
  }
  const found = returned.some((hit) => expected.includes(hit.documentId));
  return { outcome: found ? "hit" : "miss", returned };
}

/**
 * Where the right answer ranked, and how close the best wrong chunk came.
 * The gap between the two is what a threshold has to fit into.
 */
export function separation(run: CaseRun): {
  expectedRank?: number;
  expectedScore?: number;
  bestOtherScore?: number;
} {
  const expected = run.evalCase.expectedDocumentIds;
  const rank = run.ranked.findIndex((hit) => expected.includes(hit.documentId));
  const other = run.ranked.find((hit) => !expected.includes(hit.documentId));
  return {
    ...(rank === -1 ? {} : { expectedRank: rank + 1, expectedScore: run.ranked[rank]!.score }),
    ...(other ? { bestOtherScore: other.score } : {}),
  };
}

export interface SweepRow extends RetrievalSettings {
  hits: number;
  misses: number;
  correctEmpty: number;
  noise: number;
  /** hits + correctEmpty: questions where retrieval did the right thing. */
  correct: number;
  total: number;
  /** Chunks returned across all questions - more chunks, longer (and costlier) prompts. */
  returnedChunks: number;
}

export function scoreSettings(runs: readonly CaseRun[], settings: RetrievalSettings): SweepRow {
  const row: SweepRow = {
    ...settings,
    hits: 0,
    misses: 0,
    correctEmpty: 0,
    noise: 0,
    correct: 0,
    total: runs.length,
    returnedChunks: 0,
  };
  for (const run of runs) {
    const { outcome, returned } = judge(run, settings);
    if (outcome === "hit") row.hits++;
    else if (outcome === "miss") row.misses++;
    else if (outcome === "correct_empty") row.correctEmpty++;
    else row.noise++;
    row.returnedChunks += returned.length;
  }
  row.correct = row.hits + row.correctEmpty;
  return row;
}

/** minScore 0.00, 0.05 … 0.80. Integer steps, so no 0.30000000000000004 in the table. */
export const MIN_SCORE_GRID: readonly number[] = Array.from({ length: 17 }, (_, i) => i / 20);
export const TOP_K_GRID: readonly number[] = Array.from({ length: MAX_TOP_K }, (_, i) => i + 1);

/**
 * Every (k, minScore) pair scored from the same rankings. Cheap: the
 * questions were embedded and searched once, the grid is just filtering.
 */
export function sweep(
  runs: readonly CaseRun[],
  topKs: readonly number[] = TOP_K_GRID,
  minScores: readonly number[] = MIN_SCORE_GRID,
): SweepRow[] {
  return topKs.flatMap((topK) =>
    minScores.map((minScore) => scoreSettings(runs, { topK, minScore })),
  );
}

export interface Recommendation {
  row: SweepRow;
  /** Lowest and highest minScore that tie with the pick at the same k. */
  band: { from: number; to: number };
}

/**
 * A suggestion to read against the table, not a decision. The rules, in order:
 *
 * 1. Most questions correct.
 * 2. Fewest misses. A missed fact costs more than a noisy chunk: Stage 8's
 *    grounding check can block a number the model invents from noise, but it
 *    can't supply a fact retrieval never found.
 * 3. Smallest k. Fewer chunks, shorter prompt.
 * 4. The middle of the tied minScore band, not its edge. The edge is the
 *    point where one of *these* 18 questions flips, so a new question worded
 *    a little differently would land on the wrong side of it.
 */
export function recommend(rows: readonly SweepRow[]): Recommendation {
  if (rows.length === 0) throw new Error("recommend needs at least one row");
  const mostCorrect = Math.max(...rows.map((row) => row.correct));
  let tied = rows.filter((row) => row.correct === mostCorrect);
  const fewestMisses = Math.min(...tied.map((row) => row.misses));
  tied = tied.filter((row) => row.misses === fewestMisses);
  const smallestK = Math.min(...tied.map((row) => row.topK));
  const band = tied.filter((row) => row.topK === smallestK).sort((a, b) => a.minScore - b.minScore);
  return {
    row: band[Math.floor((band.length - 1) / 2)]!,
    band: { from: band[0]!.minScore, to: band[band.length - 1]!.minScore },
  };
}

const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/**
 * Indexes the fixture garages into a throwaway in-memory store through the
 * production indexer (same chunker, same embedder), then asks every question
 * through the production retriever with no threshold, so each question's
 * full top-5 ranking is kept for the sweep.
 *
 * In-memory search is exact cosine; Qdrant's HNSW is approximate, but at a
 * few dozen points it returns the same ranking.
 */
export async function runRetrievalEval(
  embedder: Embedder,
  fixtures: KnowledgeFixtures,
  variant: QueryVariant,
): Promise<CaseRun[]> {
  const store = new InMemoryVectorStore();
  const indexer = new KnowledgeIndexer(embedder, store, silentLogger);
  for (const request of fixtureIndexRequests(fixtures.garages)) await indexer.index(request);

  const retriever = new KnowledgeRetriever(
    embedder,
    store,
    { topK: MAX_TOP_K, minScore: -1 },
    silentLogger,
  );
  const runs: CaseRun[] = [];
  for (const evalCase of resolveEvalCases(fixtures)) {
    const { info, chunks } = await retriever.retrieve(
      evalRequest(evalCase, QUERY_VARIANTS[variant]),
    );
    // The retriever degrades quietly in production; in an eval that would
    // turn an outage into a column of misses, so stop instead.
    if (info.status === "failed") {
      throw new Error(`retrieval failed for ${evalCase.id}; check the embedder config`);
    }
    if (chunks.some((hit) => hit.businessId !== evalCase.businessId)) {
      throw new Error(`tenant leak: ${evalCase.id} got another business's chunk`);
    }
    runs.push({
      evalCase,
      ranked: chunks.map((hit) => ({ documentId: hit.documentId, score: hit.score })),
    });
  }
  return runs;
}

/** An unanswered case whose only customer message is the eval question. */
function evalRequest(evalCase: EvalCase, reason: string): SuggestionRequest {
  return {
    recoveryCaseId: `eval-${evalCase.id}`,
    businessId: evalCase.businessId,
    caseType: "unanswered",
    reason,
    estimatedValue: 0,
    customer: { displayName: "eval", phone: "+972500000000" },
    conversationContext: [
      { direction: "inbound", text: evalCase.question, occurredAt: "2026-09-01T10:00:00.000Z" },
    ],
    correlationId: `eval-${evalCase.id}`,
  };
}
