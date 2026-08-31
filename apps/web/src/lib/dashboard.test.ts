import { describe, expect, it } from "vitest";
import { LEADS } from "../data/leads.js";
import {
  bucketSummaries,
  filteredSortedRows,
  heroTotal,
  openLeads,
  recoveredThisMonth,
  topFiveValue,
  type StatusMap,
} from "./dashboard.js";

describe("openLeads", () => {
  it("excludes leads with a status", () => {
    const status: StatusMap = { 1: "sent", 2: "dismissed" };
    const open = openLeads(LEADS, status);
    expect(open.some((lead) => lead.id === "1")).toBe(false);
    expect(open.some((lead) => lead.id === "2")).toBe(false);
    expect(open.length).toBe(LEADS.length - 2);
  });
});

describe("heroTotal", () => {
  it("sums the value of every open lead", () => {
    const total = heroTotal(LEADS, {});
    expect(total).toBe(LEADS.reduce((sum, lead) => sum + lead.value, 0));
  });

  it("drops resolved leads from the total", () => {
    const withoutFirst = heroTotal(LEADS, {});
    const status: StatusMap = { [LEADS[0]!.id]: "sent" };
    const total = heroTotal(LEADS, status);
    expect(total).toBe(withoutFirst - LEADS[0]!.value);
  });
});

describe("topFiveValue", () => {
  it("sums the five highest-value open leads", () => {
    const top5 = [...LEADS].sort((a, b) => b.value - a.value).slice(0, 5);
    const expected = top5.reduce((sum, lead) => sum + lead.value, 0);
    expect(topFiveValue(LEADS, {})).toBe(expected);
  });
});

describe("recoveredThisMonth", () => {
  it("adds sent-lead value on top of the baseline", () => {
    const status: StatusMap = { [LEADS[0]!.id]: "sent" };
    const result = recoveredThisMonth(LEADS, status);
    expect(result).toBe(6280 + LEADS[0]!.value);
  });
});

describe("bucketSummaries", () => {
  it("returns one summary per bucket with count and amount", () => {
    const summaries = bucketSummaries(LEADS, {});
    expect(summaries).toHaveLength(3);
    const leadBucket = summaries.find((b) => b.key === "lead")!;
    const expectedCount = LEADS.filter((l) => l.kind === "lead").length;
    expect(leadBucket.count).toBe(expectedCount);
  });

  it("gives the largest bucket a 100% fill", () => {
    const summaries = bucketSummaries(LEADS, {});
    expect(Math.max(...summaries.map((b) => b.fillPercent))).toBe(100);
  });
});

describe("filteredSortedRows", () => {
  it("keeps only the matching kind when filtered", () => {
    const rows = filteredSortedRows(LEADS, {}, "quote");
    expect(rows.every((lead) => lead.kind === "quote")).toBe(true);
  });

  it("sorts unresolved leads before resolved ones", () => {
    const status: StatusMap = { [LEADS[0]!.id]: "sent" };
    const rows = filteredSortedRows(LEADS, status, "all");
    const firstResolvedIndex = rows.findIndex((lead) => status[lead.id]);
    const lastUnresolvedIndex = rows.map((lead) => !status[lead.id]).lastIndexOf(true);
    expect(lastUnresolvedIndex).toBeLessThan(firstResolvedIndex);
  });

  it("sorts by value descending within the same resolution state", () => {
    const rows = filteredSortedRows(LEADS, {}, "all");
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.value).toBeGreaterThanOrEqual(rows[i]!.value);
    }
  });
});
