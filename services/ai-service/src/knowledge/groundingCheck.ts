/**
 * Deterministic guard on AI output (AGENTS.md: AI is untrusted computation):
 * every number in a generated message must appear in what the model was
 * shown - the retrieved knowledge or the conversation. A number from anywhere
 * else is invented: a price the model guessed, another garage's price it
 * can't have seen, or the internal estimatedValue passed off as a price.
 *
 * What it can't catch: a number that *is* in a source. If a knowledge
 * document itself says "offer 50% off", "50" is grounded. Instructions inside
 * sources are handled by the prompt (they're data, not instructions) and by
 * the mandatory human review before sending, not here.
 */

// Digit runs, joined by "," "." or ":" - "650", "1,200", "08:00", "3.5".
const NUMBER_PATTERN = /\d+(?:[.,:]\d+)*/g;

export interface GroundingResult {
  grounded: boolean;
  /** Canonical forms of the message's numbers that no source contains. */
  ungrounded: string[];
}

export function checkGrounding(message: string, sources: readonly string[]): GroundingResult {
  const allowed = new Set<string>();
  for (const source of sources) {
    for (const number of extractNumbers(source)) {
      allowed.add(number);
      // "טיפול 10,000 ק״מ" is often said as "10 אלף" - allow the thousands count too.
      const value = Number(number);
      if (value >= 1_000 && value % 1_000 === 0) allowed.add(String(value / 1_000));
    }
  }
  const ungrounded = [...new Set(extractNumbers(message))].filter((number) => !allowed.has(number));
  return { grounded: ungrounded.length === 0, ungrounded };
}

/**
 * Every number in the text, in one canonical form so the same value written
 * two ways compares equal: "1,200" = "1200", "08:00" = "8:00" = "8",
 * "450.00" = "450".
 */
export function extractNumbers(text: string): string[] {
  return [...text.matchAll(NUMBER_PATTERN)].flatMap(([token]) => canonicalize(token));
}

function canonicalize(token: string): string[] {
  // A time. On the hour it becomes just the hour, so "עד 17" matches "17:00".
  const time = token.match(/^(\d{1,2}):(\d{2})$/);
  if (time) {
    const hour = String(Number(time[1]));
    return [time[2] === "00" ? hour : `${hour}:${time[2]}`];
  }
  // Thousands separators (Israeli style: "," groups, "." decimals).
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(token))
    return [canonicalNumber(token.replace(/,/g, ""))];
  if (/^\d+(?:\.\d+)?$/.test(token)) return [canonicalNumber(token)];
  // Anything else ("450,900", "1.2.3", "8:00:00"): check each digit run on its own.
  return token.split(/[.,:]/).map(canonicalNumber);
}

/** Drops leading zeros and trailing decimal zeros: "08" → "8", "450.00" → "450". */
function canonicalNumber(digits: string): string {
  return String(Number(digits));
}
