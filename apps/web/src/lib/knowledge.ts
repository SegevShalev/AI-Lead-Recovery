import type { KnowledgeDocument, KnowledgeDocumentType, SuggestionOutcome } from "./api.js";

export const KNOWLEDGE_TYPE_LABEL: Record<KnowledgeDocumentType, string> = {
  service: "Services & prices",
  policy: "Policies",
  faq: "FAQ",
  style: "Tone & style",
  example: "Example replies",
  other: "Other",
};

const TYPE_ORDER = Object.keys(KNOWLEDGE_TYPE_LABEL) as KnowledgeDocumentType[];

/** Groups documents by type in a fixed, owner-friendly order; empty groups are left out. */
export function groupByType(
  documents: KnowledgeDocument[],
): { type: KnowledgeDocumentType; label: string; documents: KnowledgeDocument[] }[] {
  return TYPE_ORDER.map((type) => ({
    type,
    label: KNOWLEDGE_TYPE_LABEL[type],
    documents: documents
      .filter((doc) => doc.type === type)
      .sort((a, b) => a.title.localeCompare(b.title, "he")),
  })).filter((group) => group.documents.length > 0);
}

export interface KnowledgeBasis {
  tone: "used" | "none" | "failed";
  text: string;
}

/**
 * What the drawer says under a suggestion about the facts it was built on.
 * "failed" is called out loudly: the message was written without the
 * business's prices/policies, so the human reviewer should check it.
 */
export function knowledgeBasis(
  outcome: Extract<SuggestionOutcome, { status: "ok" }>,
): KnowledgeBasis {
  if (outcome.retrieval.status === "failed") {
    return {
      tone: "failed",
      text: "Business knowledge was unavailable — this was written without your prices or policies. Check it before sending.",
    };
  }
  if (outcome.knowledgeDocuments.length > 0) {
    return {
      tone: "used",
      text: `Based on: ${outcome.knowledgeDocuments.map((doc) => doc.title).join(", ")}`,
    };
  }
  return { tone: "none", text: "No business knowledge used" };
}
