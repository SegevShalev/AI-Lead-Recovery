import { describe, expect, it } from "vitest";
import { evaluateUnanswered } from "./unanswered.js";

const NOW = new Date("2026-08-31T12:00:00.000Z");

describe("evaluateUnanswered", () => {
  it("flags an inbound message older than the threshold with no reply", () => {
    const result = evaluateUnanswered(
      [{ direction: "inbound", occurredAt: new Date("2026-08-31T10:00:00.000Z") }],
      60,
      NOW,
    );
    expect(result.isUnanswered).toBe(true);
    expect(result.reason).toContain("60 minutes");
  });

  it("does not flag when the inbound message is within the threshold", () => {
    const result = evaluateUnanswered(
      [{ direction: "inbound", occurredAt: new Date("2026-08-31T11:50:00.000Z") }],
      60,
      NOW,
    );
    expect(result.isUnanswered).toBe(false);
  });

  it("does not flag when the last message is outbound", () => {
    const result = evaluateUnanswered(
      [
        { direction: "inbound", occurredAt: new Date("2026-08-31T09:00:00.000Z") },
        { direction: "outbound", occurredAt: new Date("2026-08-31T09:05:00.000Z") },
      ],
      60,
      NOW,
    );
    expect(result.isUnanswered).toBe(false);
  });

  it("does not flag an empty conversation", () => {
    expect(evaluateUnanswered([], 60, NOW).isUnanswered).toBe(false);
  });
});
