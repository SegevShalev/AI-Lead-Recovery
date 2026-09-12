import type {
  Logger,
  SuggestionErrorCode,
  SuggestionRequest,
  SuggestionResponse,
} from "@ai-lead-recovery/shared";
import { modelOutputSchema, PROMPT_VERSION } from "./prompts.js";
import type { GenerationInput, SuggestionProvider } from "./providers/types.js";
import { ProviderCallError } from "./providers/types.js";

const MAX_PRIMARY_ATTEMPTS = 3;
const MAX_FALLBACK_ATTEMPTS = 1;

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
): Promise<AttemptSuccess | AttemptFailure> {
  let lastCode: SuggestionErrorCode = "provider_error";
  let lastAttempt = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastAttempt = attempt;
    let callError: ProviderCallError;
    try {
      const raw = await provider.generate(input);
      const parsed = modelOutputSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ProviderCallError(
          "model output failed schema validation",
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
      callError =
        error instanceof ProviderCallError
          ? error
          : new ProviderCallError(
              error instanceof Error ? error.message : "unknown provider error",
              "provider_error",
              true,
            );
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
  ) {}

  async generate(request: SuggestionRequest): Promise<SuggestionResponse> {
    const input: GenerationInput = {
      caseType: request.caseType,
      reason: request.reason,
      estimatedValue: request.estimatedValue,
      customer: request.customer,
      conversationContext: request.conversationContext,
    };
    const correlationId = request.correlationId;

    const primaryResult = await runWithRetries(
      this.primary,
      input,
      MAX_PRIMARY_ATTEMPTS,
      this.logger,
      correlationId,
    );
    if (primaryResult.ok) {
      this.logSuccess(primaryResult, correlationId, false);
      return this.toResult(primaryResult);
    }

    if (this.fallback) {
      const fallbackResult = await runWithRetries(
        this.fallback,
        input,
        MAX_FALLBACK_ATTEMPTS,
        this.logger,
        correlationId,
      );
      if (fallbackResult.ok) {
        this.logSuccess(fallbackResult, correlationId, true);
        return this.toResult(fallbackResult);
      }
      this.logger.warn("suggestion degraded after primary and fallback both failed", {
        correlationId,
        primaryProvider: this.primary.name,
        fallbackProvider: this.fallback.name,
        errorCode: fallbackResult.code,
      });
      return { status: "degraded", errorCode: fallbackResult.code };
    }

    this.logger.warn("suggestion degraded, no fallback configured", {
      correlationId,
      primaryProvider: this.primary.name,
      errorCode: primaryResult.code,
    });
    return { status: "degraded", errorCode: primaryResult.code };
  }

  private logSuccess(
    result: AttemptSuccess,
    correlationId: string | undefined,
    servedByFallback: boolean,
  ): void {
    this.logger.info("suggestion generated", {
      correlationId,
      model: result.model,
      promptVersion: PROMPT_VERSION,
      attempts: result.attempts,
      servedByFallback,
    });
  }

  private toResult(result: AttemptSuccess): SuggestionResponse {
    return {
      status: "ok",
      message: result.message,
      language: "he",
      reason: result.reason,
      model: result.model,
      promptVersion: PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
    };
  }
}
