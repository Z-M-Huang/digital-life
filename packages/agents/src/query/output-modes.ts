import { z } from 'zod';

export const queryOutputModeSchema = z.enum([
  'grounded',
  'qualified',
  'clarification',
  'abstention',
]);

export const reflectionSignalSchema = z.object({
  category: z.enum([
    'missing_context',
    'stale_coverage',
    'uncertain_learning',
    'capability_gap',
    'drift',
  ]),
  detail: z.string().min(1),
});

export const queryAgentOutputSchema = z.object({
  mode: queryOutputModeSchema,
  answer: z.string().default(''),
  clarificationQuestion: z.string().optional(),
  citedEvidenceIds: z.array(z.string()).default([]),
  reflectionSignals: z.array(reflectionSignalSchema).default([]),
});

export type QueryOutputMode = z.infer<typeof queryOutputModeSchema>;
export type ReflectionSignal = z.infer<typeof reflectionSignalSchema>;
export type QueryAgentOutput = z.infer<typeof queryAgentOutputSchema>;
