import { z } from 'zod';

export const claimPayloadSchema = z.object({
  kind: z.enum(['factual', 'style', 'behavior', 'reasoning']),
  subject: z.string().optional(),
  predicate: z.string().optional(),
  object: z.string().optional(),
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  status: z.enum(['candidate', 'validated', 'disputed']).default('candidate'),
});

export const consolidatedFragmentSchema = z.object({
  kind: z.enum(['factual', 'style', 'behavior', 'reasoning']),
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  authorities: z.array(z.string().min(1)).default([]),
  sourceMaterialIds: z.array(z.string()).default([]),
  evidenceSpans: z.array(z.string()).default([]),
  status: z.enum(['fragment', 'claim', 'disputed']).default('fragment'),
});

export const consolidationOutputSchema = z.object({
  fragments: z.array(consolidatedFragmentSchema).default([]),
  claims: z.array(claimPayloadSchema).default([]),
});

export type ClaimPayload = z.infer<typeof claimPayloadSchema>;
export type ConsolidatedAgentFragment = z.infer<typeof consolidatedFragmentSchema>;
export type ConsolidationAgentOutput = z.infer<typeof consolidationOutputSchema>;
