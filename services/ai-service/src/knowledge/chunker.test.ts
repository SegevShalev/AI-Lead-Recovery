import { describe, expect, it } from "vitest";
import {
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_CHARS,
  chunkDocument,
  WHOLE_DOCUMENT_MAX_CHARS,
} from "./chunker.js";

const WARRANTY_PARAGRAPHS = [
  "אחריות על עבודה: כל עבודה שמבוצעת במוסך מגיעה עם אחריות של 6 חודשים או 10,000 ק״מ, המוקדם מביניהם. האחריות חלה על העבודה עצמה ועל החלקים שסופקו על ידינו.",
  "חלקים שהלקוח מביא בעצמו: במקרה כזה האחריות היא על העבודה בלבד, ולא על החלק. אם החלק פגום, עלות הפירוק וההרכבה מחדש תחול על הלקוח.",
  "איך מממשים אחריות: יש להגיע למוסך עם החשבונית המקורית. בדיקת טענת אחריות היא ללא עלות. אם התקלה אינה קשורה לעבודה שבוצעה, נמסור הצעת מחיר לפני כל תיקון.",
  "מה לא מכוסה: נזק שנגרם מתאונה, משימוש לא סביר ברכב, או מתיקון שבוצע במוסך אחר אחרי העבודה שלנו. בלאי טבעי של רפידות, צמיגים ומגבים אינו מכוסה.",
  "החזרים: אם לא ניתן לתקן תקלה שבאחריות, יינתן זיכוי מלא על העבודה. החזר כספי במזומן אינו אפשרי, הזיכוי ניתן לשימוש בכל שירות במוסך במשך שנה.",
];
const LONG_POLICY = {
  type: "policy" as const,
  title: "מדיניות אחריות",
  content: WARRANTY_PARAGRAPHS.join("\n\n"),
};

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== "");
}

describe("chunkDocument", () => {
  it("keeps a short service document as one chunk, prefixed with its title", () => {
    const chunks = chunkDocument({
      type: "service",
      title: "החלפת רפידות בלמים",
      content: "החלפת רפידות בלמים קדמיות: 450 ₪ כולל עבודה.",
    });
    expect(chunks).toEqual([
      { index: 0, text: "החלפת רפידות בלמים\nהחלפת רפידות בלמים קדמיות: 450 ₪ כולל עבודה." },
    ]);
  });

  it("keeps a faq whole even when it is longer than a normal chunk", () => {
    const content = LONG_POLICY.content;
    expect(content.length).toBeGreaterThan(CHUNK_MAX_CHARS);

    const chunks = chunkDocument({ type: "faq", title: "שאלות על אחריות", content });
    expect(chunks).toHaveLength(1);
  });

  it("splits a service document once it is too big to stay whole", () => {
    const content = Array.from({ length: 6 }, () => LONG_POLICY.content).join("\n\n");
    expect(content.length).toBeGreaterThan(WHOLE_DOCUMENT_MAX_CHARS);

    const chunks = chunkDocument({ type: "service", title: "מחירון מלא", content });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
  });

  it("splits a long policy into several chunks, all under the limit and all titled", () => {
    const chunks = chunkDocument(LONG_POLICY);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, i) => i));
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      expect(chunk.text.startsWith("מדיניות אחריות\n")).toBe(true);
    }
  });

  it("loses no content: every word of the document is in some chunk", () => {
    const chunkWords = new Set(chunkDocument(LONG_POLICY).flatMap((chunk) => words(chunk.text)));
    for (const word of words(LONG_POLICY.content)) expect(chunkWords).toContain(word);
  });

  it("repeats the end of each chunk at the start of the next one", () => {
    const chunks = chunkDocument(LONG_POLICY);
    const body = (text: string) => text.slice("מדיניות אחריות\n".length);

    for (let i = 1; i < chunks.length; i++) {
      const previous = body(chunks[i - 1]!.text);
      const firstLine = body(chunks[i]!.text).split("\n")[0]!;
      expect(firstLine.length).toBeLessThanOrEqual(CHUNK_OVERLAP_CHARS);
      expect(previous.endsWith(firstLine)).toBe(true);
    }
  });

  it("ignores empty paragraphs and normalizes Windows line endings", () => {
    const chunks = chunkDocument({
      type: "policy",
      title: "ביטולים",
      content:
        "\r\n\r\nביטול תור עד 24 שעות מראש ללא עלות.\r\n\r\n   \r\n\r\n\r\nאיחור של יותר מ-15 דקות עלול לדחות את התור.\r\n",
    });
    expect(chunks).toEqual([
      {
        index: 0,
        text: "ביטולים\nביטול תור עד 24 שעות מראש ללא עלות.\nאיחור של יותר מ-15 דקות עלול לדחות את התור.",
      },
    ]);
  });

  it("returns no chunks for a document with no content", () => {
    expect(chunkDocument({ type: "other", title: "ריק", content: " \n\n \t" })).toEqual([]);
  });

  it("hard-splits a paragraph that has no sentence breaks, without cutting words", () => {
    const content = Array.from({ length: 120 }, (_, i) => `מילה${i}`).join(" ");
    const chunks = chunkDocument({ type: "example", title: "דוגמה", content });

    expect(chunks.length).toBeGreaterThan(1);
    const allowed = new Set(["דוגמה", ...words(content)]);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      for (const word of words(chunk.text)) expect(allowed).toContain(word);
    }
  });

  it("caps a very long title so the chunk still fits", () => {
    const chunks = chunkDocument({ ...LONG_POLICY, title: "כותרת ".repeat(100) });
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
  });

  it("is deterministic", () => {
    expect(chunkDocument(LONG_POLICY)).toEqual(chunkDocument(LONG_POLICY));
  });
});
