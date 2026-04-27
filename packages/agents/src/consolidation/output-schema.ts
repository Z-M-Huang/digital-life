import { z } from 'zod';

export const claimPayloadSchema = z.object({
  kind: z.enum(['factual', 'style', 'behavior', 'reasoning']),
  subject: z.string().nullable(),
  predicate: z.string().nullable(),
  object: z.string().nullable(),
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  status: z.enum(['candidate', 'validated', 'disputed']),
});

export const consolidatedFragmentSchema = z.object({
  kind: z.enum(['factual', 'style', 'behavior', 'reasoning']),
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  authorities: z.array(z.string().min(1)),
  sourceMaterialIds: z.array(z.string()),
  evidenceSpans: z.array(z.string()),
  status: z.enum(['fragment', 'claim', 'disputed']),
});

export const consolidationOutputSchema = z.object({
  fragments: z.array(consolidatedFragmentSchema),
  claims: z.array(claimPayloadSchema),
});

export type ClaimPayload = z.infer<typeof claimPayloadSchema>;
export type ConsolidatedAgentFragment = z.infer<typeof consolidatedFragmentSchema>;
export type ConsolidationAgentOutput = z.infer<typeof consolidationOutputSchema>;
