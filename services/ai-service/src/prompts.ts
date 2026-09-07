import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { GenerationInput } from "./providers/types.js";

export const PROMPT_VERSION = "hebrew-followup-v1";

export const modelOutputSchema = z.object({
  message: z.string().min(1),
  reason: z.string().min(1),
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;

const CASE_TYPE_LABELS: Record<string, string> = {
  unanswered: "הלקוח לא קיבל מענה להודעה האחרונה שלו",
  quote_no_response: "נשלחה הצעת מחיר ולא התקבלה תגובה",
  appointment_no_confirmation: "נקבע תור ולא התקבל אישור מהלקוח",
  dormant_customer: "לקוח שלא היה פעיל תקופה ארוכה",
};

let cachedSystemTemplate: string | undefined;
function loadSystemTemplate(): string {
  cachedSystemTemplate ??= readFileSync(
    join(process.cwd(), "prompts", `${PROMPT_VERSION}.txt`),
    "utf-8",
  );
  return cachedSystemTemplate;
}

export function buildHebrewFollowupPrompt(input: GenerationInput): {
  system: string;
  user: string;
} {
  const contextLines = input.conversationContext
    .map((m) => `[${m.direction === "outbound" ? "עסק" : "לקוח"} | ${m.occurredAt}] ${m.text}`)
    .join("\n");

  const user = [
    `סוג המקרה: ${CASE_TYPE_LABELS[input.caseType] ?? input.caseType}`,
    `סיבה: ${input.reason}`,
    `שם הלקוח: ${input.customer.displayName}`,
    `שווי משוער: ${input.estimatedValue}`,
    "",
    "<conversation_context>",
    contextLines,
    "</conversation_context>",
  ].join("\n");

  return { system: loadSystemTemplate(), user };
}
