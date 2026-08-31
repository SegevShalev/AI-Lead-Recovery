export interface MessageForRule {
  direction: "inbound" | "outbound";
  occurredAt: Date;
}

export interface RuleResult {
  isUnanswered: boolean;
  reason: string;
}

/**
 * First recovery rule (docs/architecture/service-boundaries.md): an inbound
 * message with no outbound reply within `thresholdMinutes`. `messages` must
 * be sorted ascending by `occurredAt` — the caller owns that ordering since
 * it already comes sorted out of the database query.
 */
export function evaluateUnanswered(
  messages: MessageForRule[],
  thresholdMinutes: number,
  now: Date = new Date(),
): RuleResult {
  const last = messages.at(-1);
  if (!last || last.direction !== "inbound") {
    return { isUnanswered: false, reason: "" };
  }

  const minutesSinceLastMessage = (now.getTime() - last.occurredAt.getTime()) / 60_000;
  if (minutesSinceLastMessage < thresholdMinutes) {
    return { isUnanswered: false, reason: "" };
  }

  return { isUnanswered: true, reason: `no reply within ${thresholdMinutes} minutes` };
}
