import type { GenerationInput, SuggestionProvider } from "./types.js";
import { ProviderCallError } from "./types.js";

/**
 * Lets tests exercise every generator failure branch deterministically,
 * without needing a real provider to fail on demand.
 */
export type MockFailureMode =
  "provider_timeout" | "provider_error" | "provider_unavailable" | "invalid_output";

export interface MockProviderOptions {
  failureMode?: MockFailureMode;
  name?: string;
}

const CASE_TYPE_OPENERS: Record<string, string> = {
  unanswered: "ראיתי שלא הספקנו לחזור אליך",
  quote_no_response: "רציתי לחזור בקשר להצעת המחיר ששלחנו",
  appointment_no_confirmation: "רציתי לוודא שהתור שקבענו עדיין מתאים לך",
  dormant_customer: "מזמן לא שמענו ממך ורצינו להתעדכן",
};

export class MockSuggestionProvider implements SuggestionProvider {
  readonly name: string;

  constructor(private readonly options: MockProviderOptions = {}) {
    this.name = options.name ?? "mock";
  }

  async generate(input: GenerationInput): Promise<unknown> {
    switch (this.options.failureMode) {
      case "provider_timeout":
        throw new ProviderCallError("mock provider timed out", "provider_timeout", true);
      case "provider_error":
        throw new ProviderCallError("mock provider errored", "provider_error", true);
      case "provider_unavailable":
        throw new ProviderCallError("mock provider unavailable", "provider_unavailable", false);
      case "invalid_output":
        // Deliberately malformed - wrong type, missing `reason` - so the
        // generator's schema validation (not this provider) is what fails it.
        return { message: 42 };
      default:
        break;
    }

    const opener = CASE_TYPE_OPENERS[input.caseType] ?? "רציתי לחזור אליך";
    return {
      message: `היי ${input.customer.displayName}, ${opener}. נשמח לעזור בכל שאלה שיש לך.`,
      reason: `Deterministic mock suggestion for case type "${input.caseType}"`,
    };
  }
}
