import type {
  Logger,
  RetrievalInfo,
  SuggestionErrorCode,
  SuggestionRequest,
  SuggestionResponse,
} from "@ai-lead-recovery/shared";
import { checkGrounding } from "./knowledge/groundingCheck.js";
import type { Retriever } from "./knowledge/retriever.js";
import { modelOutputSchema, PROMPT_VERSION } from "./prompts.js";
import type { GenerationInput, SuggestionProvider, TokenUsage } from "./providers/types.js";
import { ProviderCallError } from "./providers/types.js";

const MAX_PRIMARY_ATTEMPTS = 3;
const MAX_FALLBACK_ATTEMPTS = 1;

/**
 * What one request cost and went through - for logs and the Stage 9
 * comparison. Internal: not part of the suggestion contract.
 */
export interface GenerationTrace {
  /** Model calls across primary and fallback. */
  attempts: number;
  /** Attempts rejected because the message had a number found in no source. */
  groundingRejections: number;
  /** Summed over every attempt, since every attempt is billed. 0 for the mock. */
  inputTokens: number;
  outputTokens: number;
  /** Also known when the suggestion degraded (the response then has no `retrieval`). */
  retrievalStatus: RetrievalInfo["status"];
  /** Chunks the model was shown, and the documents they came from (best match first, no repeats). */
  knowledgeChunks: number;
  knowledgeDocumentIds: string[];
}

interface AttemptSuccess {
  ok: true;
  message: string;
  reason: string;
  model: string;
  attempts: number;
}
interface AttemptFailure {
  ok: false;
  code: SuggestionErrorCode;
  attempts: number;
}

async function runWithRetries(
  provider: SuggestionProvider,
  input: GenerationInput,
  maxAttempts: number,
  logger: Logger,
  correlationId: string | undefined,
  trace: GenerationTrace,
): Promise<AttemptSuccess | AttemptFailure> {
  let lastCode: SuggestionErrorCode = "provider_error";
  let lastAttempt = 0;
  // Everything the model was shown that may contain a fact it's allowed to
  // repeat. Not the case's estimatedValue: that's internal, never a price.
  const groundingSources = [
    ...input.knowledge.map((snippet) => snippet.text),
    ...input.conversationContext.map((message) => message.text),
    input.customer.displayName,
  ];
  const addUsage = (usage: TokenUsage | undefined) => {
    trace.inputTokens += usage?.inputTokens ?? 0;
    trace.outputTokens += usage?.outputTokens ?? 0;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastAttempt = attempt;
    trace.attempts++;
    let callError: ProviderCallError;
    try {
      const response = await provider.generate(input);
      addUsage(response.usage);
      const parsed = modelOutputSchema.safeParse(response.output);
      if (!parsed.success) {
        throw new ProviderCallError(
          "model output failed schema validation",
          "invalid_output",
          true,
        );
      }
      const grounding = checkGrounding(parsed.data.message, groundingSources);
      if (!grounding.grounded) {
        trace.groundingRejections++;
        // A count, not the numbers: they are generated message content.
        logger.warn("suggestion failed grounding check", {
          correlationId,
          provider: provider.name,
          attempt,
          ungroundedNumbers: grounding.ungrounded.length,
        });
        // Same path as malformed output: another attempt may stay on the facts.
        throw new ProviderCallError(
          "model output mentions numbers found in no source",
          "invalid_output",
          true,
        );
      }
      return {
        ok: true,
        message: parsed.data.message,
        reason: parsed.data.reason,
        model: provider.name,
        attempts: attempt,
      };
    } catch (error) {
      if (error instanceof ProviderCallError) {
        callError = error;
        // Set only when the provider threw after a billed call (e.g. non-JSON reply).
        addUsage(error.usage);
      } else {
        callError = new ProviderCallError(
          error instanceof Error ? error.message : "unknown provider error",
          "provider_error",
          true,
        );
      }
    }

    lastCode = callError.code;
    logger.warn("suggestion provider attempt failed", {
      correlationId,
      provider: provider.name,
      attempt,
      maxAttempts,
      code: callError.code,
      retryable: callError.retryable,
    });

    if (!callError.retryable) break;
  }

  return { ok: false, code: lastCode, attempts: lastAttempt };
}

export class SuggestionGenerator {
  constructor(
    private readonly primary: SuggestionProvider,
    private readonly fallback: SuggestionProvider | undefined,
    private readonly logger: Logger,
    private readonly retriever: Retriever,
  ) {}

  async generate(request: SuggestionRequest): Promise<SuggestionResponse> {
    return (await this.generateWithTrace(request)).response;
  }

  /** Same as generate, plus what it cost - used by the Stage 9 comparison. */
  async generateWithTrace(
    request: SuggestionRequest,
  ): Promise<{ response: SuggestionResponse; trace: GenerationTrace }> {
    // Once per request, before generation, never per retry attempt. It can't
    // throw: a failure comes back as status "failed" and generation goes on
    // without knowledge (degrade rule). The grounding check is what keeps
    // that safe: with no knowledge, no price can pass.
    const retrieval = await this.retriever.retrieve(request);

    const input: GenerationInput = {
      caseType: request.caseType,
      reason: request.reason,
      estimatedValue: request.estimatedValue,
      customer: request.customer,
      conversationContext: request.conversationContext,
      knowledge: retrieval.chunks.map((chunk) => ({ type: chunk.type, text: chunk.text })),
    };
    const correlationId = request.correlationId;
    const trace: GenerationTrace = {
      attempts: 0,
      groundingRejections: 0,
      inputTokens: 0,
      outputTokens: 0,
      retrievalStatus: retrieval.info.status,
      knowledgeChunks: retrieval.chunks.length,
      knowledgeDocumentIds: [...new Set(retrieval.chunks.map((chunk) => chunk.documentId))],
    };

    const primaryResult = await runWithRetries(
      this.primary,
      input,
      MAX_PRIMARY_ATTEMPTS,
      this.logger,
      correlationId,
      trace,
    );
    if (primaryResult.ok) {
      this.logSuccess(primaryResult, correlationId, false, trace);
      return { response: this.toResult(primaryResult, retrieval.info), trace };
    }

    if (this.fallback) {
      const fallbackResult = await runWithRetries(
        this.fallback,
        input,
        MAX_FALLBACK_ATTEMPTS,
        this.logger,
        correlationId,
        trace,
      );
      if (fallbackResult.ok) {
        this.logSuccess(fallbackResult, correlationId, true, trace);
        return { response: this.toResult(fallbackResult, retrieval.info), trace };
      }
      this.logger.warn("suggestion degraded after primary and fallback both failed", {
        correlationId,
        primaryProvider: this.primary.name,
        fallbackProvider: this.fallback.name,
        errorCode: fallbackResult.code,
      });
      return { response: { status: "degraded", errorCode: fallbackResult.code }, trace };
    }

    this.logger.warn("suggestion degraded, no fallback configured", {
      correlationId,
      primaryProvider: this.primary.name,
      errorCode: primaryResult.code,
    });
    return { response: { status: "degraded", errorCode: primaryResult.code }, trace };
  }

  private logSuccess(
    result: AttemptSuccess,
    correlationId: string | undefined,
    servedByFallback: boolean,
    trace: GenerationTrace,
  ): void {
    this.logger.info("suggestion generated", {
      correlationId,
      model: result.model,
      promptVersion: PROMPT_VERSION,
      attempts: result.attempts,
      servedByFallback,
      knowledgeChunks: trace.knowledgeChunks,
      inputTokens: trace.inputTokens,
      outputTokens: trace.outputTokens,
    });
  }

  private toResult(result: AttemptSuccess, retrieval: RetrievalInfo): SuggestionResponse {
    return {
      status: "ok",
      message: result.message,
      language: "he",
      reason: result.reason,
      model: result.model,
      promptVersion: PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      retrieval,
    };
  }
}
