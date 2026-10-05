import type { Env } from "@ai-lead-recovery/config";
import type { Embedder } from "./embedder.js";
import { MockEmbedder } from "./mockEmbedder.js";
import { OpenAIEmbedder } from "./openaiEmbedder.js";

export function createEmbedderFromEnv(
  env: Pick<Env, "EMBEDDING_PROVIDER" | "EMBEDDING_API_KEY">,
): Embedder {
  switch (env.EMBEDDING_PROVIDER) {
    case "mock":
      return new MockEmbedder();
    case "openai":
      // loadEnv already enforces this; kept so the factory is safe on its own.
      if (!env.EMBEDDING_API_KEY) {
        throw new Error("EMBEDDING_API_KEY is required when EMBEDDING_PROVIDER=openai");
      }
      return new OpenAIEmbedder({ apiKey: env.EMBEDDING_API_KEY });
  }
}
