import { describe, expect, it, vi } from "vitest";
import { EmbeddingError } from "./embedder.js";
import { OPENAI_EMBEDDING_MODEL, OpenAIEmbedder } from "./openaiEmbedder.js";

const DIMENSIONS = 1536;
const vectorOf = (value: number) => new Array<number>(DIMENSIONS).fill(value);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function embedderReturning(response: Response | Error) {
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { fetchImpl, embedder: new OpenAIEmbedder({ apiKey: "sk-test", fetchImpl }) };
}

async function embedError(embedder: OpenAIEmbedder): Promise<unknown> {
  return embedder.embed(["שלום"]).catch((error: unknown) => error);
}

describe("OpenAIEmbedder", () => {
  it("sends the model and texts, and returns vectors in input order", async () => {
    // The API may return items in any order; `index` says which input each belongs to.
    const { fetchImpl, embedder } = embedderReturning(
      jsonResponse({
        object: "list",
        model: OPENAI_EMBEDDING_MODEL,
        data: [
          { object: "embedding", index: 1, embedding: vectorOf(0.2) },
          { object: "embedding", index: 0, embedding: vectorOf(0.1) },
        ],
        usage: { prompt_tokens: 8, total_tokens: 8 },
      }),
    );

    const vectors = await embedder.embed(["ראשון", "שני"]);

    expect(vectors.map((vector) => vector[0])).toEqual([0.1, 0.2]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect(init?.headers).toMatchObject({ authorization: "Bearer sk-test" });
    expect(JSON.parse(init?.body as string)).toEqual({
      model: OPENAI_EMBEDDING_MODEL,
      input: ["ראשון", "שני"],
      encoding_format: "float",
    });
  });

  it("makes no request for an empty batch", async () => {
    const { fetchImpl, embedder } = embedderReturning(jsonResponse({ data: [] }));
    expect(await embedder.embed([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, "auth", false],
    [429, "rate_limited", true],
    [503, "unavailable", true],
    [400, "invalid_input", false],
  ] as const)("maps HTTP %i to %s (retryable=%s)", async (status, code, retryable) => {
    const { embedder } = embedderReturning(jsonResponse({ error: { message: "nope" } }, status));
    const error = await embedError(embedder);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect(error).toMatchObject({ code, retryable });
    // The status is enough to debug; the provider's body is not echoed.
    expect((error as Error).message).not.toContain("nope");
  });

  it("maps a timeout to a retryable timeout error", async () => {
    const timeout = new DOMException("signal timed out", "TimeoutError");
    const { embedder } = embedderReturning(timeout as unknown as Error);
    expect(await embedError(embedder)).toMatchObject({ code: "timeout", retryable: true });
  });

  it("maps a network failure to a retryable unavailable error", async () => {
    const { embedder } = embedderReturning(new TypeError("fetch failed"));
    expect(await embedError(embedder)).toMatchObject({ code: "unavailable", retryable: true });
  });

  it.each([
    ["a body that is not JSON", new Response("<html>", { status: 200 })],
    ["a body with the wrong shape", jsonResponse({ data: "nope" })],
    ["fewer vectors than inputs", jsonResponse({ data: [] })],
    ["vectors of the wrong size", jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2] }] })],
  ])("rejects %s as invalid_response", async (_label, response) => {
    const { embedder } = embedderReturning(response);
    expect(await embedError(embedder)).toMatchObject({ code: "invalid_response" });
  });

  it("rejects empty text before calling the API", async () => {
    const { fetchImpl, embedder } = embedderReturning(jsonResponse({ data: [] }));
    const error = await embedder.embed([""]).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "invalid_input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
