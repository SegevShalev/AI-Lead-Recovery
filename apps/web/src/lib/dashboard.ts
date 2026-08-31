import {
  BASE_RECOVERED_THIS_MONTH,
  BUCKETS,
  type Lead,
  type LeadKind,
  type LeadStatus,
} from "../data/leads.js";

export type StatusMap = Record<number, LeadStatus>;
export type FilterKey = "all" | LeadKind;

export function openLeads(leads: Lead[], status: StatusMap): Lead[] {
  return leads.filter((lead) => !status[lead.id]);
}

export function heroTotal(leads: Lead[], status: StatusMap): number {
  return openLeads(leads, status).reduce((sum, lead) => sum + lead.value, 0);
}

export function topFiveValue(leads: Lead[], status: StatusMap): number {
  return [...openLeads(leads, status)]
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .reduce((sum, lead) => sum + lead.value, 0);
}

export function recoveredThisMonth(leads: Lead[], status: StatusMap): number {
  const sentValue = leads
    .filter((lead) => status[lead.id] === "sent")
    .reduce((sum, lead) => sum + lead.value, 0);
  return BASE_RECOVERED_THIS_MONTH + sentValue;
}

export interface BucketSummary {
  key: LeadKind;
  title: string;
  note: string;
  barColor: string;
  count: number;
  amount: number;
  fillPercent: number;
}

export function bucketSummaries(leads: Lead[], status: StatusMap): BucketSummary[] {
  const open = openLeads(leads, status);
  const amounts = BUCKETS.map((bucket) =>
    open.filter((lead) => lead.kind === bucket.key).reduce((sum, lead) => sum + lead.value, 0),
  );
  const maxAmount = Math.max(1, ...amounts);
  return BUCKETS.map((bucket, i) => {
    const set = open.filter((lead) => lead.kind === bucket.key);
    const amount = amounts[i] ?? 0;
    return {
      ...bucket,
      count: set.length,
      amount,
      fillPercent: Math.round((amount / maxAmount) * 100),
    };
  });
}

export function filteredSortedRows(leads: Lead[], status: StatusMap, filter: FilterKey): Lead[] {
  const filtered = filter === "all" ? leads : leads.filter((lead) => lead.kind === filter);
  return [...filtered].sort((a, b) => {
    const resolvedA = status[a.id] ? 1 : 0;
    const resolvedB = status[b.id] ? 1 : 0;
    return resolvedA - resolvedB || b.value - a.value;
  });
}
