import { z } from 'zod';

const baseFragmentSchema = z.object({
  content: z.string().min(1, 'fragment content cannot be empty'),
  confidence: z.number().min(0).max(1),
  evidenceSpan: z.string().nullable(),
});

export const factualOutputSchema = z.object({
  fragments: z.array(
    baseFragmentSchema.extend({
      entities: z.array(z.string()),
      subject: z.string().nullable(),
      predicate: z.string().nullable(),
      object: z.string().nullable(),
    }),
  ),
});

export const styleOutputSchema = z.object({
  fragments: z.array(
    baseFragmentSchema.extend({
      toneMarkers: z.array(z.string()),
      exampleQuote: z.string().nullable(),
    }),
  ),
});

export const behaviorOutputSchema = z.object({
  fragments: z.array(
    baseFragmentSchema.extend({
      pattern: z.string().min(1),
      instances: z.array(z.string()),
    }),
  ),
});

export const reasoningOutputSchema = z.object({
  fragments: z.array(
    baseFragmentSchema.extend({
      tradeoff: z.string().nullable(),
      heuristic: z.string().nullable(),
    }),
  ),
});

export const learnerOutputSchemas = {
  factual: factualOutputSchema,
  style: styleOutputSchema,
  behavior: behaviorOutputSchema,
  reasoning: reasoningOutputSchema,
} as const;

export type LearnerKind = keyof typeof learnerOutputSchemas;
