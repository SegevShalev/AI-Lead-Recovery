import type {
  KnowledgeDocumentType,
  MessageDirection,
  RecoveryCaseType,
  SuggestionErrorCode,
} from "@ai-lead-recovery/shared";

/**
 * One piece of business knowledge shown to the model. Untrusted data, like
 * the conversation: facts to use, never instructions to follow. `text` is
 * the stored chunk, which already starts with its document's title.
 */
export interface KnowledgeSnippet {
  type: KnowledgeDocumentType;
  text: string;
}

export interface GenerationInput {
  caseType: RecoveryCaseType;
  reason: string;
  estimatedValue: number;
  customer: { displayName: string; phone: string };
  conversationContext: { direction: MessageDirection; text: string; occurredAt: string }[];
  /** Best match first. Empty = no knowledge (none matched, or retrieval failed). */
  knowledge: KnowledgeSnippet[];
}

/**
 * Output budget per call, the same for every real provider so their results
 * (and the Stage 9 cost estimate) are comparable. A follow-up message plus a
 * one-line reason needs a few hundred tokens.
 */
export const MAX_OUTPUT_TOKENS = 1024;

/** Tokens one model call used - what it cost. Provider-neutral names. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Thrown by a provider on any call failure. `retryable` drives whether the
 * generator retries the same provider or moves straight to the fallback -
 * e.g. a timeout is worth retrying, bad auth is not. `usage` is set when the
 * call itself went through and was paid for (e.g. the reply wasn't JSON).
 */
export class ProviderCallError extends Error {
  constructor(
    message: string,
    public readonly code: SuggestionErrorCode,
    public readonly retryable: boolean,
    public readonly usage?: TokenUsage,
  ) {
    super(message);
    this.name = "ProviderCallError";
  }
}

export interface ProviderResponse {
  /** Raw, not-yet-validated model output. */
  output: unknown;
  /** Absent when the provider doesn't bill by token (the mock). */
  usage?: TokenUsage;
}

export interface SuggestionProvider {
  /** Identifies which model actually produced a result, per the contract's `model` field. */
  readonly name: string;
  /**
   * The generator is solely responsible for validating `output` - a provider
   * must never leak SDK types past this boundary.
   */
  generate(input: GenerationInput): Promise<ProviderResponse>;
}
