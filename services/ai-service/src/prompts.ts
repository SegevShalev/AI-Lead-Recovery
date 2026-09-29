import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeDocumentType } from "@ai-lead-recovery/shared";
import { z } from "zod";
import type { GenerationInput, KnowledgeSnippet } from "./providers/types.js";

/** v2 adds <business_knowledge> (Phase 4). v1 stays in prompts/ as history. */
export const PROMPT_VERSION = "hebrew-followup-v2";

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

const KNOWLEDGE_TYPE_LABELS: Record<KnowledgeDocumentType, string> = {
  service: "שירות ומחיר",
  policy: "מדיניות",
  faq: "שאלה נפוצה",
  style: "סגנון",
  example: "דוגמה",
  other: "אחר",
};

const NO_KNOWLEDGE = "(אין מידע עסקי רלוונטי לשיחה הזו)";

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
    .map(
      (m) =>
        `[${m.direction === "outbound" ? "עסק" : "לקוח"} | ${m.occurredAt}] ${neutralizeDelimiters(m.text)}`,
    )
    .join("\n");

  const user = [
    `סוג המקרה: ${CASE_TYPE_LABELS[input.caseType] ?? input.caseType}`,
    `סיבה: ${input.reason}`,
    `שם הלקוח: ${input.customer.displayName}`,
    `שווי משוער (פנימי, לא ללקוח): ${input.estimatedValue}`,
    "",
    "<business_knowledge>",
    renderKnowledge(input.knowledge),
    "</business_knowledge>",
    "",
    "<conversation_context>",
    contextLines,
    "</conversation_context>",
  ].join("\n");

  return { system: loadSystemTemplate(), user };
}

/**
 * Takes the chunks themselves, not a retriever, so any selection of chunks
 * (retrieved top-k, or all of a business's chunks for the Stage 9
 * comparison) goes through the same rendering.
 */
export function renderKnowledge(knowledge: readonly KnowledgeSnippet[]): string {
  if (knowledge.length === 0) return NO_KNOWLEDGE;
  return knowledge
    .map(
      (snippet, i) =>
        `[מקור ${i + 1} | ${KNOWLEDGE_TYPE_LABELS[snippet.type]}]\n${neutralizeDelimiters(snippet.text)}`,
    )
    .join("\n\n");
}

/**
 * Untrusted text (customer messages, knowledge documents) could contain
 * "</business_knowledge>" to close our block early and write text that looks
 * like it comes from outside the data. Our tag names are removed from it, so
 * every block has exactly one opening and one closing tag.
 */
export function neutralizeDelimiters(text: string): string {
  return text.replace(/<\s*\/?\s*(?:business_knowledge|conversation_context)\b[^>]*>/gi, "");
}
