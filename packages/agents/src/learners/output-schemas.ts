import { z } from 'zod';

const baseFragmentSchema = z.object({
  content: z.string().min(1, 'fragment content cannot be empty'),
  confidence: z.number().min(0).max(1),
  evidenceSpan: z.string().optional(),
});

export const factualOutputSchema = z.object({
  fragments: z
    .array(
      baseFragmentSchema.extend({
        entities: z.array(z.string()).default([]),
        subject: z.string().optional(),
        predicate: z.string().optional(),
        object: z.string().optional(),
      }),
    )
    .default([]),
});

export const styleOutputSchema = z.object({
  fragments: z
    .array(
      baseFragmentSchema.extend({
        toneMarkers: z.array(z.string()).default([]),
        exampleQuote: z.string().optional(),
      }),
    )
    .default([]),
});

export const behaviorOutputSchema = z.object({
  fragments: z
    .array(
      baseFragmentSchema.extend({
        pattern: z.string().min(1),
        instances: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

export const reasoningOutputSchema = z.object({
  fragments: z
    .array(
      baseFragmentSchema.extend({
        tradeoff: z.string().optional(),
        heuristic: z.string().optional(),
      }),
    )
    .default([]),
});

export const learnerOutputSchemas = {
  factual: factualOutputSchema,
  style: styleOutputSchema,
  behavior: behaviorOutputSchema,
  reasoning: reasoningOutputSchema,
} as const;

export type LearnerKind = keyof typeof learnerOutputSchemas;
