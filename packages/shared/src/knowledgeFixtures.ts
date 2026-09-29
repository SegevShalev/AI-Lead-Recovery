import { z } from "zod";
import { knowledgeDocumentInputSchema } from "./knowledge.js";

/**
 * Formats of the repo-level fixtures in fixtures/knowledge/. They are shared
 * between two owners: services/api's seed script loads garages.json into
 * Mongo, and the ai-service eval runner indexes the same documents and scores
 * retrieval against eval-questions.json. Garages are referenced by a stable
 * `key`, not a Mongo id, since ids differ per database.
 */
/**
 * A seeded document. `key` is its stable identity (stored as
 * metadata.fixtureKey), so the title can be edited without the seed
 * mistaking it for a new document.
 */
export const fixtureDocumentSchema = knowledgeDocumentInputSchema.extend({
  key: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes"),
});
export type FixtureDocument = z.infer<typeof fixtureDocumentSchema>;

export const garageFixtureSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  documents: z.array(fixtureDocumentSchema).min(1),
});
export type GarageFixture = z.infer<typeof garageFixtureSchema>;

export const garagesFixtureSchema = z.object({
  garages: z.array(garageFixtureSchema).min(1),
});
export type GaragesFixture = z.infer<typeof garagesFixtureSchema>;

export const evalQuestionSchema = z.object({
  id: z.string().min(1),
  garage: z.string().min(1),
  question: z.string().min(1),
  // Empty array = the correct retrieval result is nothing.
  expectedDocumentTitles: z.array(z.string()),
  note: z.string().optional(),
});
export type EvalQuestion = z.infer<typeof evalQuestionSchema>;

export const evalQuestionsFixtureSchema = z.object({
  questions: z.array(evalQuestionSchema).min(1),
});
export type EvalQuestionsFixture = z.infer<typeof evalQuestionsFixtureSchema>;
