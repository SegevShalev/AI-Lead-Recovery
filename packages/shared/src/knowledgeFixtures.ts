import { z } from "zod";
import { knowledgeDocumentInputSchema } from "./knowledge.js";

/**
 * Formats of the repo-level fixtures in fixtures/knowledge/. They are shared
 * between two owners: services/api's seed script loads garages.json into
 * Mongo, and the ai-service eval runner indexes the same documents and scores
 * retrieval against eval-questions.json. Garages are referenced by a stable
 * `key`, not a Mongo id, since ids differ per database.
 */
export const garageFixtureSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  documents: z.array(knowledgeDocumentInputSchema).min(1),
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
