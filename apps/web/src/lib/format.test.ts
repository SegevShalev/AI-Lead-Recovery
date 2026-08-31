import { describe, expect, it } from "vitest";
import { formatElapsed, formatMoney, initialsOf } from "./format.js";

describe("formatMoney", () => {
  it("formats with thousands separators and a dollar sign", () => {
    expect(formatMoney(1840)).toBe("$1,840");
    expect(formatMoney(390)).toBe("$390");
  });
});

describe("formatElapsed", () => {
  it("shows days under a month", () => {
    expect(formatElapsed(9)).toBe("9 days");
    expect(formatElapsed(1)).toBe("1 day");
  });

  it("switches to months at 30 days", () => {
    expect(formatElapsed(30)).toBe("1 month");
    expect(formatElapsed(214)).toBe("7 months");
  });
});

describe("initialsOf", () => {
  it("takes the first letter of the first two words", () => {
    expect(initialsOf("Marcus Whitfield")).toBe("MW");
    expect(initialsOf("Ray Okonkwo Contracting")).toBe("RO");
  });
});
