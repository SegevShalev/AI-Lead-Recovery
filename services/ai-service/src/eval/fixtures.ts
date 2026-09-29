import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type EvalQuestionsFixture,
  evalQuestionsFixtureSchema,
  type GaragesFixture,
  garagesFixtureSchema,
  type IndexDocumentRequest,
} from "@ai-lead-recovery/shared";

/** Repo-level fixtures shared with services/api's seed - see fixtures/knowledge/README.md. */
const FIXTURES_DIR = fileURLToPath(new URL("../../../../fixtures/knowledge/", import.meta.url));

/**
 * Every fixture document is sent as version 1. Re-running after an edit to
 * garages.json still updates it: the same version replaces the chunks.
 */
const FIXTURE_DOCUMENT_VERSION = 1;

export interface KnowledgeFixtures {
  garages: GaragesFixture;
  questions: EvalQuestionsFixture;
}

export function loadKnowledgeFixtures(): KnowledgeFixtures {
  return {
    garages: garagesFixtureSchema.parse(readJson("garages.json")),
    questions: evalQuestionsFixtureSchema.parse(readJson("eval-questions.json")),
  };
}

function readJson(fileName: string): unknown {
  return JSON.parse(readFileSync(FIXTURES_DIR + fileName, "utf8"));
}

/**
 * Fixture garages have no Mongo id, so they get a readable businessId of
 * their own. It can't collide with the API's seeded businesses (ObjectIds),
 * so `index:fixtures` never touches documents indexed through the API.
 */
export function fixtureBusinessId(garageKey: string): string {
  return `fixture-${garageKey}`;
}

/**
 * Exactly what services/api would send to `POST /internal/knowledge/index`
 * for each fixture document. documentId = the document's stable fixture key.
 */
export function fixtureIndexRequests(garages: GaragesFixture): IndexDocumentRequest[] {
  return garages.garages.flatMap((garage) =>
    garage.documents.map((doc) => ({
      businessId: fixtureBusinessId(garage.key),
      documentId: doc.key,
      version: FIXTURE_DOCUMENT_VERSION,
      type: doc.type,
      title: doc.title,
      content: doc.content,
    })),
  );
}

export interface EvalCase {
  id: string;
  businessId: string;
  question: string;
  /** documentIds (fixture keys) that count as a correct result. Empty = nothing should come back. */
  expectedDocumentIds: string[];
}

/**
 * Questions label their answer by document title (readable for whoever
 * writes them); the index knows documents by id. Resolved here, within the
 * question's own garage, and a title that doesn't resolve is an error rather
 * than a silent "miss".
 */
export function resolveEvalCases({ garages, questions }: KnowledgeFixtures): EvalCase[] {
  return questions.questions.map((question) => {
    const garage = garages.garages.find((candidate) => candidate.key === question.garage);
    if (!garage)
      throw new Error(`eval question ${question.id}: unknown garage "${question.garage}"`);
    const expectedDocumentIds = question.expectedDocumentTitles.map((title) => {
      const doc = garage.documents.find((candidate) => candidate.title === title);
      if (!doc) {
        throw new Error(
          `eval question ${question.id}: no document titled "${title}" in ${garage.key}`,
        );
      }
      return doc.key;
    });
    return {
      id: question.id,
      businessId: fixtureBusinessId(garage.key),
      question: question.question,
      expectedDocumentIds,
    };
  });
}
