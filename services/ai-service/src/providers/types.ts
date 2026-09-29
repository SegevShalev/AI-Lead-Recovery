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
 * Thrown by a provider on any call failure. `retryable` drives whether the
 * generator retries the same provider or moves straight to the fallback -
 * e.g. a timeout is worth retrying, bad auth is not.
 */
export class ProviderCallError extends Error {
  constructor(
    message: string,
    public readonly code: SuggestionErrorCode,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderCallError";
  }
}

export interface SuggestionProvider {
  /** Identifies which model actually produced a result, per the contract's `model` field. */
  readonly name: string;
  /**
   * Returns the raw, not-yet-validated model output. The generator is solely
   * responsible for schema validation - a provider must never leak SDK types
   * past this boundary.
   */
  generate(input: GenerationInput): Promise<unknown>;
}
