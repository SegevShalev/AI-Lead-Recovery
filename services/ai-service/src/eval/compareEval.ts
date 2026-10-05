import {
  emptyRetrieval,
  type GaragesFixture,
  type SuggestionRequest,
} from "@ai-lead-recovery/shared";
import { chunkDocument } from "../knowledge/chunker.js";
import type { Embedder } from "../knowledge/embedder.js";
import { extractNumbers } from "../knowledge/groundingCheck.js";
import { InMemoryVectorStore } from "../knowledge/inMemoryVectorStore.js";
import { KnowledgeIndexer } from "../knowledge/knowledgeIndexer.js";
import {
  KnowledgeRetriever,
  type RetrievalOptions,
  type RetrievalOutcome,
  type Retriever,
  retrievalContextVersion,
} from "../knowledge/retriever.js";
import { type ChunkHit, chunkPointId } from "../knowledge/vectorStore.js";
import type { SuggestionProvider } from "../providers/types.js";
import { type GenerationTrace, SuggestionGenerator } from "../suggestionGenerator.js";
import {
  EVAL_CASE_REASON,
  type EvalCase,
  evalRequest,
  fixtureIndexRequests,
  type KnowledgeFixtures,
  resolveEvalCases,
  silentLogger,
} from "./fixtures.js";

/**
 * The Phase 4 exit comparison (phase-4-checklist.md, "Three-way comparison"):
 * 1. no knowledge - Phase 3 behaviour;
 * 2. all knowledge - every chunk of the garage in the prompt, no retrieval;
 * 3. rag - retrieval as built in Stages 5-7.
 * Each mode is only a different Retriever in front of the same production
 * SuggestionGenerator: same prompt, retries and grounding check.
 */
export const COMPARE_MODES = ["no knowledge", "all knowledge", "rag"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

class NoKnowledgeRetriever implements Retriever {
  async retrieve(): Promise<RetrievalOutcome> {
    return { info: emptyRetrieval, chunks: [] };
  }
}

/**
 * Every chunk of the business, in fixture order. Eval-only: `sources` may
 * exceed the contract's cap of 5, which is fine because this info is never
 * sent over HTTP.
 */
class AllKnowledgeRetriever implements Retriever {
  constructor(private readonly chunksByBusiness: ReadonlyMap<string, ChunkHit[]>) {}

  async retrieve(request: SuggestionRequest): Promise<RetrievalOutcome> {
    const chunks = this.chunksByBusiness.get(request.businessId) ?? [];
    return {
      info: {
        status: chunks.length > 0 ? "used" : "empty",
        sources: chunks.map(({ documentId, version, chunkId, score }) => ({
          documentId,
          version,
          chunkId,
          score,
        })),
        contextVersion: retrievalContextVersion(chunks),
      },
      chunks,
    };
  }
}

/** Chunked exactly as the indexer would, without an embedder (mode 2 needs no vectors). */
export function allFixtureChunks(garages: GaragesFixture): Map<string, ChunkHit[]> {
  const byBusiness = new Map<string, ChunkHit[]>();
  for (const request of fixtureIndexRequests(garages)) {
    const chunks = chunkDocument(request).map((chunk) => ({
      chunkId: chunkPointId(request.businessId, request.documentId, chunk.index),
      businessId: request.businessId,
      documentId: request.documentId,
      version: request.version,
      type: request.type,
      title: request.title,
      chunkIndex: chunk.index,
      text: chunk.text,
      score: 1,
    }));
    byBusiness.set(request.businessId, [...(byBusiness.get(request.businessId) ?? []), ...chunks]);
  }
  return byBusiness;
}

/**
 * The numbers in the question's expected documents, canonical form. The eval
 * questions name the right document, not the right answer, so these numbers
 * are the checkable part of it. A question whose document has no numbers
 * ("by appointment only") can't be scored this way; its messages are for
 * reading.
 */
export function expectedFacts(evalCase: EvalCase, garages: GaragesFixture): string[] {
  const requests = fixtureIndexRequests(garages).filter(
    (request) =>
      request.businessId === evalCase.businessId &&
      evalCase.expectedDocumentIds.includes(request.documentId),
  );
  return [...new Set(requests.flatMap((request) => extractNumbers(request.content)))];
}

export interface AnswerScore {
  degraded: boolean;
  expected: string[];
  /** Expected facts the message states. */
  stated: string[];
  /**
   * Numbers in the message that aren't expected facts and aren't from the
   * question. Grounding already rejected any from no source at all, so these
   * are facts from the wrong document: off-topic, or a wrong answer.
   */
  other: string[];
}

export function scoreAnswer(
  message: string | undefined,
  expected: readonly string[],
  question: string,
): AnswerScore {
  if (message === undefined) {
    return { degraded: true, expected: [...expected], stated: [], other: [] };
  }
  const said = new Set(extractNumbers(message));
  // Same leniency as grounding: "10 אלף" states "10,000".
  const forms = (fact: string) => {
    const value = Number(fact);
    return value >= 1_000 && value % 1_000 === 0 ? [fact, String(value / 1_000)] : [fact];
  };
  const stated = expected.filter((fact) => forms(fact).some((form) => said.has(form)));
  const accounted = new Set([...expected.flatMap(forms), ...extractNumbers(question)]);
  return {
    degraded: false,
    expected: [...expected],
    stated,
    other: [...said].filter((number) => !accounted.has(number)),
  };
}

export interface CaseResult {
  evalCase: EvalCase;
  mode: CompareMode;
  /** Undefined when the suggestion degraded. */
  message?: string;
  score: AnswerScore;
  trace: GenerationTrace;
  /** An expected document was among the chunks shown to the model. */
  rightDocumentShown: boolean;
}

export interface ModeSummary {
  mode: CompareMode;
  questions: number;
  /** Questions with a right document (the rest should get no facts at all). */
  answerable: number;
  rightDocumentShown: number;
  /** Questions whose right document has numbers, and how many of those the message got. */
  scorable: number;
  answered: number;
  factsExpected: number;
  factsStated: number;
  otherNumbers: number;
  groundingRejections: number;
  degraded: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
}

export function summarize(mode: CompareMode, results: readonly CaseResult[]): ModeSummary {
  const summary: ModeSummary = {
    mode,
    questions: 0,
    answerable: 0,
    rightDocumentShown: 0,
    scorable: 0,
    answered: 0,
    factsExpected: 0,
    factsStated: 0,
    otherNumbers: 0,
    groundingRejections: 0,
    degraded: 0,
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  for (const result of results.filter((r) => r.mode === mode)) {
    const { score, trace } = result;
    summary.questions++;
    if (result.evalCase.expectedDocumentIds.length > 0) {
      summary.answerable++;
      if (result.rightDocumentShown) summary.rightDocumentShown++;
    }
    if (score.expected.length > 0) {
      summary.scorable++;
      if (score.stated.length > 0) summary.answered++;
    }
    summary.factsExpected += score.expected.length;
    summary.factsStated += score.stated.length;
    summary.otherNumbers += score.other.length;
    summary.groundingRejections += trace.groundingRejections;
    if (score.degraded) summary.degraded++;
    summary.attempts += trace.attempts;
    summary.inputTokens += trace.inputTokens;
    summary.outputTokens += trace.outputTokens;
  }
  return summary;
}

export interface ComparisonOptions {
  fixtures: KnowledgeFixtures;
  /** Primary only, no fallback: a fallback would blur which model produced the numbers. */
  provider: SuggestionProvider;
  /** Used by the rag mode only. */
  embedder: Embedder;
  retrieval: RetrievalOptions;
  modes?: readonly CompareMode[];
  onResult?: (result: CaseResult) => void;
}

/** Every eval question through every mode. One model call per attempt: this is the part that costs. */
export async function runComparison(options: ComparisonOptions): Promise<CaseResult[]> {
  const { fixtures, provider, embedder } = options;
  const retrievers: Record<CompareMode, () => Promise<Retriever>> = {
    "no knowledge": async () => new NoKnowledgeRetriever(),
    "all knowledge": async () => new AllKnowledgeRetriever(allFixtureChunks(fixtures.garages)),
    rag: async () => {
      const store = new InMemoryVectorStore();
      const indexer = new KnowledgeIndexer(embedder, store, silentLogger);
      for (const request of fixtureIndexRequests(fixtures.garages)) await indexer.index(request);
      return new KnowledgeRetriever(embedder, store, options.retrieval, silentLogger);
    },
  };

  const cases = resolveEvalCases(fixtures);
  const results: CaseResult[] = [];
  for (const mode of options.modes ?? COMPARE_MODES) {
    const generator = new SuggestionGenerator(
      provider,
      undefined,
      silentLogger,
      await retrievers[mode](),
    );
    for (const evalCase of cases) {
      const { response, trace } = await generator.generateWithTrace(
        evalRequest(evalCase, EVAL_CASE_REASON),
      );
      // Production degrades quietly to "no knowledge"; here that would make
      // the rag row look like the first row for the wrong reason.
      if (trace.retrievalStatus === "failed") {
        throw new Error(`retrieval failed for ${evalCase.id}; check the embedder config`);
      }
      const message = response.status === "ok" ? response.message : undefined;
      const result: CaseResult = {
        evalCase,
        mode,
        ...(message === undefined ? {} : { message }),
        score: scoreAnswer(message, expectedFacts(evalCase, fixtures.garages), evalCase.question),
        trace,
        rightDocumentShown: trace.knowledgeDocumentIds.some((id) =>
          evalCase.expectedDocumentIds.includes(id),
        ),
      };
      results.push(result);
      options.onResult?.(result);
    }
  }
  return results;
}
