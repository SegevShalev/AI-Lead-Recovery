import { z } from "zod";
import { messageDirectionSchema, recoveryCaseTypeSchema } from "./domain.js";

/**
 * Contract locked in docs/development/phase-3-checklist.md so Track 2 can
 * build against the mock provider before Track 1's real adapter exists.
 */
export const suggestionRequestSchema = z.object({
  recoveryCaseId: z.string(),
  businessId: z.string(),
  caseType: recoveryCaseTypeSchema,
  reason: z.string(),
  estimatedValue: z.number().nonnegative(),
  customer: z.object({ displayName: z.string(), phone: z.string() }),
  // Last outbound message onward, capped at 10 - selected by the caller (API).
  conversationContext: z
    .array(
      z.object({
        direction: messageDirectionSchema,
        text: z.string(),
        occurredAt: z.string().datetime(),
      }),
    )
    .max(10),
  correlationId: z.string().optional(),
});
export type SuggestionRequest = z.infer<typeof suggestionRequestSchema>;

export const suggestionErrorCodeSchema = z.enum([
  "provider_timeout",
  "provider_error",
  "invalid_output",
  "provider_unavailable",
]);
export type SuggestionErrorCode = z.infer<typeof suggestionErrorCodeSchema>;

export const suggestionResultSchema = z.object({
  status: z.literal("ok"),
  message: z.string(),
  language: z.literal("he"),
  reason: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  generatedAt: z.string().datetime(),
});
export type SuggestionResult = z.infer<typeof suggestionResultSchema>;

export const suggestionDegradedSchema = z.object({
  status: z.literal("degraded"),
  errorCode: suggestionErrorCodeSchema,
  message: z.string().optional(),
});
export type SuggestionDegraded = z.infer<typeof suggestionDegradedSchema>;

// Always returned with HTTP 200 - an unreachable ai-service is a different,
// separate case the caller must handle (network error/non-2xx).
export const suggestionResponseSchema = z.discriminatedUnion("status", [
  suggestionResultSchema,
  suggestionDegradedSchema,
]);
export type SuggestionResponse = z.infer<typeof suggestionResponseSchema>;
