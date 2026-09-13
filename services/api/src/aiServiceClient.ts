import {
  suggestionResponseSchema,
  type SuggestionRequest,
  type SuggestionResponse,
} from "@ai-lead-recovery/shared";

export type SuggestionClientResult =
  | { ok: true; data: SuggestionResponse }
  | { ok: false; errorCode: "unreachable" | "invalid_response" };

export interface SuggestionClient {
  requestSuggestion(request: SuggestionRequest): Promise<SuggestionClientResult>;
}

/**
 * Talks to services/ai-service's `POST /internal/suggestions`
 * (docs/architecture/service-boundaries.md#services-ai-service). A network
 * failure, a non-2xx response, or a body that doesn't match the agreed
 * contract are all collapsed into one "unreachable"-shaped failure here —
 * the AI service's *own* reachable-but-failed-to-generate case is instead
 * `SuggestionResponse.status === "degraded"` and passes through untouched.
 */
export function createHttpSuggestionClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): SuggestionClient {
  return {
    async requestSuggestion(request) {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/internal/suggestions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
      } catch {
        return { ok: false, errorCode: "unreachable" };
      }

      if (!response.ok) {
        return { ok: false, errorCode: "unreachable" };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { ok: false, errorCode: "invalid_response" };
      }

      const parsed = suggestionResponseSchema.safeParse(body);
      if (!parsed.success) {
        return { ok: false, errorCode: "invalid_response" };
      }

      return { ok: true, data: parsed.data };
    },
  };
}
