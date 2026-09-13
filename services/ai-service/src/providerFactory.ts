import type { Env } from "@ai-lead-recovery/config";
import { AnthropicSuggestionProvider } from "./providers/anthropic.js";
import { MockSuggestionProvider } from "./providers/mock.js";
import type { SuggestionProvider } from "./providers/types.js";

type ProviderName = Env["AI_PROVIDER"];

export function createProvider(
  providerName: ProviderName,
  apiKey: string | undefined,
): SuggestionProvider {
  switch (providerName) {
    case "mock":
      return new MockSuggestionProvider();
    case "anthropic":
      if (!apiKey) {
        throw new Error("AI_API_KEY is required when AI_PROVIDER=anthropic");
      }
      return new AnthropicSuggestionProvider({ apiKey });
    case "openai":
    case "bedrock":
      throw new Error(`AI_PROVIDER=${providerName} is not implemented yet`);
  }
}

export function createProvidersFromEnv(env: Env): {
  primary: SuggestionProvider;
  fallback: SuggestionProvider | undefined;
} {
  const primary = createProvider(env.AI_PROVIDER, env.AI_API_KEY);
  const fallback = env.AI_FALLBACK_PROVIDER
    ? createProvider(env.AI_FALLBACK_PROVIDER, env.AI_FALLBACK_API_KEY)
    : undefined;
  return { primary, fallback };
}
