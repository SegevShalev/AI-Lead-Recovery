import { describe, expect, it, vi } from "vitest";
import { createProvider } from "../providerFactory.js";
import { OPENAI_DEFAULT_MODEL, OpenAISuggestionProvider } from "./openai.js";
import type { GenerationInput } from "./types.js";
import { MAX_OUTPUT_TOKENS, ProviderCallError } from "./types.js";

const input: GenerationInput = {
  caseType: "unanswered",
  reason: "no reply within 60 minutes",
  estimatedValue: 450,
  customer: { displayName: "דנה", phone: "+972500000000" },
  conversationContext: [
    {
      direction: "inbound",
      text: "כמה עולה להחליף רפידות?",
      occurredAt: "2026-09-01T10:00:00.000Z",
    },
  ],
  knowledge: [{ type: "service", text: "החלפת רפידות בלמים\nרפידות קדמיות: 450 ₪ כולל עבודה." }],
};

function completion(
  message: { content: string | null; refusal?: string | null },
  finishReason = "stop",
) {
  return {
    id: "chatcmpl-1",
    object: "chat.completion",
    model: "gpt-4.1-mini-2025-04-14",
    choices: [
      { index: 0, finish_reason: finishReason, message: { role: "assistant", ...message } },
    ],
    usage: { prompt_tokens: 812, completion_tokens: 64, total_tokens: 876 },
  };
}
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function providerReturning(response: Response | Error) {
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { fetchImpl, provider: new OpenAISuggestionProvider({ apiKey: "sk-test", fetchImpl }) };
}

async function generateError(provider: OpenAISuggestionProvider): Promise<ProviderCallError> {
  const error = await provider.generate(input).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderCallError);
  return error as ProviderCallError;
}

const VALID_REPLY = JSON.stringify({
  message: "היי דנה, החלפת רפידות קדמיות 450 ₪.",
  reason: "מחיר מהמחירון",
});

describe("OpenAISuggestionProvider", () => {
  it("sends prompt v2 with a strict JSON schema, and returns the parsed output and usage", async () => {
    const { fetchImpl, provider } = providerReturning(
      jsonResponse(completion({ content: VALID_REPLY })),
    );

    const result = await provider.generate(input);

    expect(result).toEqual({
      output: JSON.parse(VALID_REPLY),
      usage: { inputTokens: 812, outputTokens: 64 },
    });
    expect(provider.name).toBe(OPENAI_DEFAULT_MODEL);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init?.headers).toMatchObject({ authorization: "Bearer sk-test" });
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      model: "gpt-4.1-mini",
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      response_format: {
        type: "json_schema",
        json_schema: {
          strict: true,
          schema: { required: ["message", "reason"], additionalProperties: false },
        },
      },
    });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    // The knowledge reaches the model inside the prompt.
    expect(body.messages[1].content).toContain("450 ₪");
  });

  it("does not retry a refusal, and still reports what it cost", async () => {
    const { provider } = providerReturning(
      jsonResponse(completion({ content: null, refusal: "I can't help with that." })),
    );
    const error = await generateError(provider);
    expect(error).toMatchObject({
      code: "invalid_output",
      retryable: false,
      usage: { inputTokens: 812, outputTokens: 64 },
    });
  });

  it("treats a cut-off reply (finish_reason=length) as invalid output, not worth a retry", async () => {
    const { provider } = providerReturning(
      jsonResponse(completion({ content: '{"message": "היי' }, "length")),
    );
    const error = await generateError(provider);
    expect(error).toMatchObject({ code: "invalid_output", retryable: false });
    expect(error.message).toContain("finish_reason=length");
  });

  it("retries a reply that isn't JSON", async () => {
    const { provider } = providerReturning(jsonResponse(completion({ content: "not json" })));
    expect(await generateError(provider)).toMatchObject({
      code: "invalid_output",
      retryable: true,
    });
  });

  it("rejects a response body with the wrong shape", async () => {
    const { provider } = providerReturning(jsonResponse({ choices: [] }));
    expect(await generateError(provider)).toMatchObject({ code: "invalid_output" });
  });

  it.each([
    [401, "provider_unavailable", false],
    [404, "provider_unavailable", false],
    [400, "provider_unavailable", false],
    [429, "provider_error", true],
    [503, "provider_error", true],
  ] as const)(
    "maps HTTP %i to %s (retryable=%s), without echoing the body",
    async (status, code, retryable) => {
      const { provider } = providerReturning(
        jsonResponse({ error: { message: "secret detail" } }, status),
      );
      const error = await generateError(provider);
      expect(error).toMatchObject({ code, retryable });
      expect(error.message).not.toContain("secret detail");
    },
  );

  it("maps a timeout or network failure to a retryable provider_timeout", async () => {
    const { provider } = providerReturning(
      new DOMException("timed out", "TimeoutError") as unknown as Error,
    );
    expect(await generateError(provider)).toMatchObject({
      code: "provider_timeout",
      retryable: true,
    });
  });
});

describe("createProvider('openai')", () => {
  it("builds the OpenAI provider, and refuses without a key", () => {
    expect(createProvider("openai", "sk-test")).toBeInstanceOf(OpenAISuggestionProvider);
    expect(() => createProvider("openai", undefined)).toThrow(/AI_API_KEY is required/);
  });
});
