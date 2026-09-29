/**
 * `pnpm --filter @ai-lead-recovery/ai-service eval:compare [--yes] [--messages]`
 *
 * The Phase 4 exit evidence (docs/development/phase-4-track-1-plan.md,
 * Stage 9): every eval question through three modes - no knowledge, all of
 * the garage's knowledge, RAG - with the production generator (prompt v2,
 * retries, grounding check). Prints the estimated cost first and only spends
 * it with --yes. --messages also prints every generated message.
 *
 * Meaningful only with a real model (AI_PROVIDER=anthropic): the mock ignores
 * knowledge, so all three rows come out the same. The rag row also needs the
 * real embedder (EMBEDDING_PROVIDER=openai) and the Stage 7 settings.
 */
import { loadEnv } from "@ai-lead-recovery/config";
import {
  allFixtureChunks,
  type CaseResult,
  COMPARE_MODES,
  type CompareMode,
  type ModeSummary,
  runComparison,
  summarize,
} from "../eval/compareEval.js";
import {
  EVAL_CASE_REASON,
  evalRequest,
  loadKnowledgeFixtures,
  resolveEvalCases,
} from "../eval/fixtures.js";
import { createEmbedderFromEnv } from "../knowledge/embedderFactory.js";
import { MockEmbedder } from "../knowledge/mockEmbedder.js";
import { createProvider } from "../providerFactory.js";
import { buildHebrewFollowupPrompt } from "../prompts.js";
import { MAX_OUTPUT_TOKENS } from "../providers/anthropic.js";
import { MockSuggestionProvider } from "../providers/mock.js";

/**
 * $ per million tokens, from Anthropic's price list (2026-06). A model not
 * listed here still runs; only the dollar estimate is skipped.
 */
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
};
/** Rough: Hebrew runs about 2 characters per token. Measured tokens are printed after the run. */
const CHARS_PER_TOKEN = 2;
/** A short WhatsApp message plus a one-line reason. */
const TYPICAL_OUTPUT_TOKENS = 200;
const MAX_ATTEMPTS = 3;

const args = new Set(process.argv.slice(2));
const env = loadEnv();
const fixtures = loadKnowledgeFixtures();
const provider = createProvider(env.AI_PROVIDER, env.AI_API_KEY);
const embedder = createEmbedderFromEnv(env);
const retrieval = { topK: env.RETRIEVAL_TOP_K, minScore: env.RETRIEVAL_MIN_SCORE };
const cases = resolveEvalCases(fixtures);

console.log(`Three-way comparison · model ${provider.name} · embedder ${embedder.model}`);
console.log(
  `${cases.length} questions × ${COMPARE_MODES.length} modes · rag: RETRIEVAL_TOP_K=${retrieval.topK} ` +
    `RETRIEVAL_MIN_SCORE=${retrieval.minScore} · no fallback model`,
);
if (provider instanceof MockSuggestionProvider) {
  console.log(
    "\n⚠  Mock AI: it ignores knowledge, so the three rows will be the same. Wiring check only.\n" +
      "   Set AI_PROVIDER=anthropic and AI_API_KEY for real numbers.",
  );
}
if (embedder instanceof MockEmbedder) {
  console.log(
    "\n⚠  Mock embedder: the rag row retrieves by shared words only, so it isn't representative.\n" +
      "   Set EMBEDDING_PROVIDER=openai and finish Stage 7 first.",
  );
}

printEstimate();
if (!(provider instanceof MockSuggestionProvider) && !args.has("--yes")) {
  console.log("\nNothing was sent. Re-run with --yes to spend it.");
  process.exit(0);
}

let done = 0;
try {
  console.log("");
  const results = await runComparison({
    fixtures,
    provider,
    embedder,
    retrieval,
    onResult: () =>
      process.stdout.write(`\rrunning… ${++done}/${cases.length * COMPARE_MODES.length}`),
  });
  console.log("\n");
  printSummary(COMPARE_MODES.map((mode) => summarize(mode, results)));
  printPerQuestion(results);
  if (args.has("--messages")) printMessages(results);
} catch (error) {
  console.error(`\neval failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

/**
 * Upper bound on input: the rag prompt is never longer than the all-knowledge
 * one (it shows a subset), so rag is estimated as all-knowledge.
 */
function printEstimate(): void {
  const all = allFixtureChunks(fixtures.garages);
  const promptChars = (mode: CompareMode) =>
    cases.reduce((sum, evalCase) => {
      const request = evalRequest(evalCase, EVAL_CASE_REASON);
      const knowledge =
        mode === "no knowledge"
          ? []
          : (all.get(evalCase.businessId) ?? []).map(({ type, text }) => ({ type, text }));
      const { system, user } = buildHebrewFollowupPrompt({ ...request, knowledge });
      return sum + system.length + user.length;
    }, 0);
  const inputTokens = COMPARE_MODES.reduce(
    (sum, mode) => sum + promptChars(mode === "rag" ? "all knowledge" : mode) / CHARS_PER_TOKEN,
    0,
  );
  const calls = cases.length * COMPARE_MODES.length;
  const typical = { input: inputTokens, output: calls * TYPICAL_OUTPUT_TOKENS };
  const worst = {
    input: inputTokens * MAX_ATTEMPTS,
    output: calls * MAX_ATTEMPTS * MAX_OUTPUT_TOKENS,
  };

  console.log(`\nEstimate (rough, ${CHARS_PER_TOKEN} chars/token):`);
  console.log(
    `  typical: ${calls} calls, ~${fmt(typical.input)} input + ~${fmt(typical.output)} output tokens${dollars(typical)}`,
  );
  console.log(
    `  worst:   ${calls * MAX_ATTEMPTS} calls (every attempt retried, max output)${dollars(worst)}`,
  );
}

function dollars(tokens: { input: number; output: number }): string {
  const price = PRICES_PER_MTOK[provider.name];
  if (!price) return "";
  const cost = (tokens.input * price.input + tokens.output * price.output) / 1_000_000;
  return ` ≈ $${cost.toFixed(2)}`;
}

function printSummary(rows: ModeSummary[]): void {
  const columns: [string, (row: ModeSummary) => string][] = [
    ["mode", (r) => r.mode],
    ["right doc shown", (r) => `${r.rightDocumentShown}/${r.answerable}`],
    ["answered", (r) => `${r.answered}/${r.scorable}`],
    ["facts stated", (r) => `${r.factsStated}/${r.factsExpected}`],
    ["other numbers", (r) => String(r.otherNumbers)],
    ["grounding rejects", (r) => String(r.groundingRejections)],
    ["degraded", (r) => String(r.degraded)],
    ["input tok/q", (r) => (r.inputTokens ? fmt(r.inputTokens / r.questions) : "n/a")],
    ["output tok/q", (r) => (r.outputTokens ? fmt(r.outputTokens / r.questions) : "n/a")],
    [
      "cost",
      (r) => dollars({ input: r.inputTokens, output: r.outputTokens }).replace(" ≈ ", "") || "n/a",
    ],
  ];
  // Markdown, so it can be pasted into the PR as-is.
  console.log(`| ${columns.map(([name]) => name).join(" | ")} |`);
  console.log(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${columns.map(([, cell]) => cell(row)).join(" | ")} |`);
  console.log(
    "\nright doc shown = an expected document was in the prompt · answered = the message states at\n" +
      "least one number from the right document (questions whose document has numbers) · other\n" +
      "numbers = numbers from a wrong document · grounding rejects = attempts retried for a number\n" +
      "found in no source · tokens summed over every attempt.",
  );
}

function printPerQuestion(results: CaseResult[]): void {
  console.log(
    `\nPer question (facts stated/expected, r = grounding rejects, + = other numbers, ✗ = degraded):`,
  );
  console.log(`${"question".padEnd(30)}${COMPARE_MODES.map((mode) => mode.padEnd(16)).join("")}`);
  for (const evalCase of cases) {
    const cells = COMPARE_MODES.map((mode) => {
      const result = results.find((r) => r.mode === mode && r.evalCase.id === evalCase.id)!;
      const { score, trace } = result;
      const parts = [
        score.degraded
          ? "✗"
          : score.expected.length > 0
            ? `${score.stated.length}/${score.expected.length}`
            : "-",
        trace.groundingRejections > 0 ? `r${trace.groundingRejections}` : "",
        score.other.length > 0 ? `+${score.other.length}` : "",
      ];
      return parts.filter(Boolean).join(" ").padEnd(16);
    });
    console.log(evalCase.id.padEnd(30) + cells.join(""));
  }
}

/** Fixture questions and generated replies - fake data, printed for reading, never logged. */
function printMessages(results: CaseResult[]): void {
  for (const evalCase of cases) {
    console.log(`\n--- ${evalCase.id}: ${evalCase.question}`);
    for (const mode of COMPARE_MODES) {
      const result = results.find((r) => r.mode === mode && r.evalCase.id === evalCase.id)!;
      console.log(`  [${mode}] ${result.message ?? "(degraded)"}`);
    }
  }
}

function fmt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
