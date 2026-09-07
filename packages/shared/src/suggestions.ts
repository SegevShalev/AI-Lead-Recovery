import { z } from "zod";
import { messageDirectionSchema, recoveryCaseTypeSchema } from "./domain.js";

/**
 * Contract between services/api and services/ai-service's
 * `POST /internal/suggestions` (docs/development/phase-3-checklist.md).
 * Both services import these types so the boundary can't silently drift.
 */
export const suggestionRequestSchema = z.object({
  recoveryCaseId: z.string(),
  businessId: z.string(),
  caseType: recoveryCaseTypeSchema,
  reason: z.string(),
  estimatedValue: z.number().nonnegative(),
  customer: z.object({ displayName: z.string(), phone: z.string() }),
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

export const suggestionDegradedErrorCodeSchema = z.enum([
  "provider_timeout",
  "provider_error",
  "invalid_output",
  "provider_unavailable",
]);
export type SuggestionDegradedErrorCode = z.infer<typeof suggestionDegradedErrorCodeSchema>;

export const suggestionDegradedSchema = z.object({
  status: z.literal("degraded"),
  errorCode: suggestionDegradedErrorCodeSchema,
  message: z.string().optional(),
});
export type SuggestionDegraded = z.infer<typeof suggestionDegradedSchema>;

/** Always returned with HTTP 200 by the AI service — see phase-3-checklist.md. */
export const suggestionResponseSchema = z.discriminatedUnion("status", [
  suggestionResultSchema,
  suggestionDegradedSchema,
]);
export type SuggestionResponse = z.infer<typeof suggestionResponseSchema>;

/**
 * services/api's own response to `POST /api/recovery-cases/:id/suggestion`.
 * A superset of `suggestionResponseSchema`: the "ok" branch adds the id of
 * the persisted Suggestion record, and the AI service being unreachable
 * (as opposed to reachable-but-degraded) is folded into the same "degraded"
 * shape with errorCode "provider_unavailable" so apps/web only has one
 * failure shape to render, per docs/development/phase-3-checklist.md's
 * "AI failure/degraded mode (API side)" item.
 */
export const apiSuggestionResultSchema = suggestionResultSchema.extend({
  suggestionId: z.string(),
});
export type ApiSuggestionResult = z.infer<typeof apiSuggestionResultSchema>;

export const apiSuggestionResponseSchema = z.discriminatedUnion("status", [
  apiSuggestionResultSchema,
  suggestionDegradedSchema,
]);
export type ApiSuggestionResponse = z.infer<typeof apiSuggestionResponseSchema>;
