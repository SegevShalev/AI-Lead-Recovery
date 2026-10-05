import { z } from "zod";
import { buildHebrewFollowupPrompt } from "../prompts.js";
import type { GenerationInput, ProviderResponse, SuggestionProvider, TokenUsage } from "./types.js";
import { MAX_OUTPUT_TOKENS, ProviderCallError } from "./types.js";

/**
 * Not a reasoning model, so no hidden reasoning tokens eat into
 * MAX_OUTPUT_TOKENS; supports strict JSON-schema output on Chat Completions.
 * $0.40 / $1.60 per million input / output tokens (OpenAI model page, 2026-10).
 */
export const OPENAI_DEFAULT_MODEL = "gpt-4.1-mini";
/** Same budget as the Anthropic adapter. */
const TIMEOUT_MS = 20_000;

/**
 * OpenAI enforces this shape itself (`strict: true`), so unlike the Anthropic
 * adapter no extra "reply in JSON" instruction is appended - both get the same
 * prompt v2, which already explains what `message` and `reason` are for. The
 * generator's modelOutputSchema still validates the result.
 */
const SUGGESTION_JSON_SCHEMA = {
  type: "object",
  properties: { message: { type: "string" }, reason: { type: "string" } },
  required: ["message", "reason"],
  additionalProperties: false,
} as const;

// Only the fields we use; validated because the provider is outside this process.
const chatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable(),
        message: z.object({
          content: z.string().nullable(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }),
});

export interface OpenAIProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * `POST /v1/chat/completions` with plain fetch, like OpenAIEmbedder. Error
 * messages carry the HTTP status or finish reason only - never the prompt,
 * the reply, or the provider's error body.
 */
export class OpenAISuggestionProvider implements SuggestionProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIProviderOptions) {
    this.name = options.model ?? OPENAI_DEFAULT_MODEL;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(input: GenerationInput): Promise<ProviderResponse> {
    const { system, user } = buildHebrewFollowupPrompt(input);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.name,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_completion_tokens: MAX_OUTPUT_TOKENS,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "followup_suggestion",
              strict: true,
              schema: SUGGESTION_JSON_SCHEMA,
            },
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // Timeout or network failure: same code as the Anthropic adapter's connection error.
      throw new ProviderCallError("openai connection failure", "provider_timeout", true);
    }

    if (!response.ok) throw errorForStatus(response.status);

    const parsed = chatCompletionSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new ProviderCallError("openai response failed validation", "invalid_output", true);
    }

    // Paid for even if the reply turns out unusable, so it rides on errors too.
    const usage: TokenUsage = {
      inputTokens: parsed.data.usage.prompt_tokens,
      outputTokens: parsed.data.usage.completion_tokens,
    };
    const [choice] = parsed.data.choices;

    // Asking again gets the same answer for these, so don't spend retries on them.
    if (choice!.message.refusal) {
      throw new ProviderCallError("openai model refused", "invalid_output", false, usage);
    }
    if (choice!.finish_reason !== "stop") {
      throw new ProviderCallError(
        `openai reply incomplete (finish_reason=${choice!.finish_reason ?? "none"})`,
        "invalid_output",
        false,
        usage,
      );
    }

    try {
      return { output: JSON.parse(choice!.message.content ?? ""), usage };
    } catch {
      throw new ProviderCallError(
        "openai response was not valid JSON",
        "invalid_output",
        true,
        usage,
      );
    }
  }
}

/** Mirrors the Anthropic adapter's mapping, so retry/fallback behave the same. */
function errorForStatus(status: number): ProviderCallError {
  if (status === 429 || status >= 500) {
    return new ProviderCallError(`openai returned HTTP ${status}`, "provider_error", true);
  }
  // 400/401/403/404/422: bad key, unknown model or bad request - retrying won't help.
  return new ProviderCallError(`openai returned HTTP ${status}`, "provider_unavailable", false);
}
