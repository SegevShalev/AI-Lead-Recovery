import Anthropic from "@anthropic-ai/sdk";
import { buildHebrewFollowupPrompt } from "../prompts.js";
import type { GenerationInput, SuggestionProvider } from "./types.js";
import { ProviderCallError } from "./types.js";

const DEFAULT_MODEL = "claude-opus-5";
const MAX_OUTPUT_TOKENS = 1024;

const OUTPUT_FORMAT_INSTRUCTION =
  '\n\nהחזר אך ורק אובייקט JSON תקני, ללא טקסט נוסף לפניו או אחריו וללא עטיפת ```, בדיוק בצורה הבאה: {"message": "<ההודעה ללקוח>", "reason": "<הסבר קצר לשימוש פנימי>"}.';

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
}

export class AnthropicSuggestionProvider implements SuggestionProvider {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions) {
    this.name = options.model ?? DEFAULT_MODEL;
    this.client = new Anthropic({ apiKey: options.apiKey, timeout: 20_000, maxRetries: 0 });
  }

  async generate(input: GenerationInput): Promise<unknown> {
    const { system, user } = buildHebrewFollowupPrompt(input);

    let response;
    try {
      response = await this.client.messages.create({
        model: this.name,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: system + OUTPUT_FORMAT_INSTRUCTION,
        messages: [{ role: "user", content: user }],
      });
    } catch (error) {
      throw toProviderCallError(error);
    }

    // The generator's own Zod validation (modelOutputSchema) is the single
    // source of truth for whether this counts as valid output - this
    // provider only needs to get from "model response" to "candidate JSON".
    for (const block of response.content) {
      if (block.type === "text") {
        try {
          return JSON.parse(extractJsonText(block.text));
        } catch {
          throw new ProviderCallError(
            "anthropic response was not valid JSON",
            "invalid_output",
            true,
          );
        }
      }
    }

    throw new ProviderCallError(
      "anthropic response contained no text block",
      "invalid_output",
      true,
    );
  }
}

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? trimmed;
}

function toProviderCallError(error: unknown): ProviderCallError {
  if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError) {
    return new ProviderCallError("anthropic provider error", "provider_error", true);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderCallError("anthropic connection failure", "provider_timeout", true);
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.UnprocessableEntityError
  ) {
    return new ProviderCallError("anthropic provider unavailable", "provider_unavailable", false);
  }
  return new ProviderCallError(
    error instanceof Error ? error.message : "unknown anthropic error",
    "provider_error",
    true,
  );
}
