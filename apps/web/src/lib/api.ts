import type { Lead, LeadKind } from "../data/leads.js";

interface ApiBusiness {
  _id: string;
  name: string;
}

interface ApiCustomerRef {
  _id: string;
  displayName: string;
  phone: string;
}

interface ApiMessageRef {
  text: string;
  direction: "inbound" | "outbound";
  occurredAt: string;
}

interface ApiRecoveryCase {
  _id: string;
  type: string;
  estimatedValue: number;
  reason: string;
  detectedAt: string;
  customerId: ApiCustomerRef | string;
  lastMessage: ApiMessageRef | null;
}

// Only "unanswered" is implemented in Phase 1 (docs/development/roadmap.md);
// the rest map ahead of time so later rules need no frontend change.
const CASE_TYPE_TO_KIND: Record<string, LeadKind> = {
  unanswered: "lead",
  quote_no_response: "quote",
  appointment_no_confirmation: "lead",
  dormant_customer: "dormant",
};

function daysSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function toLead(apiCase: ApiRecoveryCase): Lead {
  const customer = typeof apiCase.customerId === "string" ? null : apiCase.customerId;
  const lastMessage = apiCase.lastMessage;
  return {
    id: apiCase._id,
    name: customer?.displayName ?? "Unknown customer",
    // No structured "vehicle" field in the data model (docs/architecture/data-model.md) —
    // left blank rather than invented; a real value can come with richer WhatsApp metadata later.
    vehicle: "",
    phone: customer?.phone ?? "",
    kind: CASE_TYPE_TO_KIND[apiCase.type] ?? "lead",
    value: apiCase.estimatedValue,
    elapsedDays: daysSince(apiCase.detectedAt),
    snippet: lastMessage?.text ?? apiCase.reason,
    rationale: apiCase.reason,
    thread: lastMessage
      ? [
          {
            from: lastMessage.direction === "inbound" ? "them" : "us",
            text: lastMessage.text,
            time: new Date(lastMessage.occurredAt).toLocaleString(),
          },
        ]
      : [],
    // Starts empty; App fetches a draft via requestSuggestion() once the drawer opens.
    draft: "",
  };
}

export type SuggestionOutcome =
  | {
      status: "ok";
      suggestionId: string;
      message: string;
      reason: string;
      language: "he";
      model: string;
      promptVersion: string;
      generatedAt: string;
    }
  | {
      status: "degraded";
      errorCode: "provider_timeout" | "provider_error" | "invalid_output" | "provider_unavailable";
      message?: string;
    };

/**
 * Always resolves (never throws) on a well-formed 200, even when the AI
 * service failed to generate — that's the "degraded" branch, not a fetch
 * error. Only a genuinely broken request to services/api itself throws.
 */
export async function requestSuggestion(recoveryCaseId: string): Promise<SuggestionOutcome> {
  const response = await fetch(
    `/api/recovery-cases/${encodeURIComponent(recoveryCaseId)}/suggestion`,
    { method: "POST" },
  );
  if (!response.ok) throw new Error(`Failed to request a suggestion (${response.status})`);
  return (await response.json()) as SuggestionOutcome;
}

/** Phase 1 has no auth/tenant switching yet — use whichever business was seeded. */
export async function fetchDemoBusiness(): Promise<ApiBusiness | null> {
  const response = await fetch("/api/businesses");
  if (!response.ok) throw new Error(`Failed to load businesses (${response.status})`);
  const body = (await response.json()) as { businesses: ApiBusiness[] };
  return body.businesses[0] ?? null;
}

export async function fetchOpenLeads(businessId: string): Promise<Lead[]> {
  const response = await fetch(
    `/api/recovery-cases?businessId=${encodeURIComponent(businessId)}&status=open`,
  );
  if (!response.ok) throw new Error(`Failed to load recovery cases (${response.status})`);
  const body = (await response.json()) as { cases: ApiRecoveryCase[] };
  return body.cases.map(toLead);
}
