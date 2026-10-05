import type { KnowledgeDocumentType } from "@ai-lead-recovery/shared";

/** What the chunker needs from an index request - nothing tenant-specific. */
export interface ChunkableDocument {
  type: KnowledgeDocumentType;
  title: string;
  content: string;
}

export interface Chunk {
  /** 0-based position in the document; part of the stored point's identity. */
  index: number;
  /** Title prefix + body. This exact text is embedded and later shown to the model. */
  text: string;
}

/** Upper bound for every chunk's `text`, title prefix included. */
export const CHUNK_MAX_CHARS = 500;
/** How much of the previous chunk's end is repeated at the start of the next one. */
export const CHUNK_OVERLAP_CHARS = 50;
/**
 * `service` and `faq` documents are a fact plus its conditions ("450 ₪
 * including labour"); splitting them would separate a price from what it is
 * for. They stay whole up to this size, and past it are split like any other
 * document so no chunk can blow past the embedding model's input limit.
 */
export const WHOLE_DOCUMENT_MAX_CHARS = 2_000;

const WHOLE_DOCUMENT_TYPES: ReadonlySet<KnowledgeDocumentType> = new Set(["service", "faq"]);
const TITLE_PREFIX_MAX_CHARS = 100;

/**
 * Pure and deterministic: the same document always gives the same chunks, so
 * re-indexing an unchanged document writes identical points.
 *
 * Every chunk starts with the document title so its embedding carries the
 * topic even when the body alone doesn't ("08:00-17:00" means little without
 * "שעות פתיחה").
 */
export function chunkDocument(doc: ChunkableDocument): Chunk[] {
  const content = doc.content.replace(/\r\n?/g, "\n").trim();
  if (content === "") return [];

  const prefix = titlePrefix(doc.title);
  if (
    WHOLE_DOCUMENT_TYPES.has(doc.type) &&
    prefix.length + content.length <= WHOLE_DOCUMENT_MAX_CHARS
  ) {
    return [{ index: 0, text: prefix + content }];
  }

  const bodyBudget = CHUNK_MAX_CHARS - prefix.length;
  // Leave room for an overlap + "\n" in front of any piece, so merging below
  // can always start a new chunk without breaking the size limit.
  const maxPieceChars = bodyBudget - CHUNK_OVERLAP_CHARS - 1;
  const bodies = mergeWithOverlap(splitIntoPieces(content, maxPieceChars), bodyBudget);
  return bodies.map((body, index) => ({ index, text: prefix + body }));
}

function titlePrefix(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, TITLE_PREFIX_MAX_CHARS);
  return clean === "" ? "" : `${clean}\n`;
}

/**
 * Paragraphs (blank-line separated) are the preferred unit. A paragraph that
 * is too big is split into lines/sentences, and anything still too big is cut
 * at the last whitespace. Colons are deliberately not a split point: in a
 * price list "טיפול 10,000 ק״מ: 650 ₪" the item and its price must stay together.
 */
function splitIntoPieces(content: string, maxPieceChars: number): string[] {
  const pieces: string[] = [];
  for (const rawParagraph of content.split(/\n\s*\n/)) {
    const paragraph = rawParagraph.trim();
    if (paragraph === "") continue;
    if (paragraph.length <= maxPieceChars) {
      pieces.push(paragraph);
      continue;
    }
    for (const sentence of paragraph.split(/\n|(?<=[.!?])\s+/)) {
      pieces.push(...hardSplit(sentence.trim(), maxPieceChars));
    }
  }
  return pieces;
}

function hardSplit(text: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    const lastSpace = window.search(/\s\S*$/);
    const cutAt = lastSpace > 0 ? lastSpace : maxChars;
    parts.push(rest.slice(0, cutAt).trim());
    rest = rest.slice(cutAt).trim();
  }
  if (rest !== "") parts.push(rest);
  return parts;
}

/** Greedy: keep adding pieces until the next one doesn't fit, then start a new chunk. */
function mergeWithOverlap(pieces: string[], bodyBudget: number): string[] {
  const bodies: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current === "" ? piece : `${current}\n${piece}`;
    if (candidate.length <= bodyBudget) {
      current = candidate;
      continue;
    }
    bodies.push(current);
    const overlap = overlapTail(current);
    current = overlap === "" ? piece : `${overlap}\n${piece}`;
  }
  if (current !== "") bodies.push(current);
  return bodies;
}

/** The end of a chunk, starting at a word boundary so no half-word is repeated. */
function overlapTail(body: string): string {
  if (body.length <= CHUNK_OVERLAP_CHARS) return body;
  const window = body.slice(body.length - CHUNK_OVERLAP_CHARS);
  const firstSpace = window.search(/\s/);
  return firstSpace === -1 ? "" : window.slice(firstSpace).trim();
}
