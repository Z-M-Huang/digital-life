import type { LearnedFragment } from '../learners/types';
import type { LLMClient } from '../llm/client';
import type { PromptBundle } from '../prompts/load';
import { type ConsolidationAgentOutput, consolidationOutputSchema } from './output-schema';

export type ConsolidationAgent = {
  consolidate: (
    fragments: LearnedFragment[],
    options?: { signal?: AbortSignal },
  ) => Promise<ConsolidationAgentOutput>;
};

const buildPrompt = (fragments: LearnedFragment[]): string =>
  [
    'Raw learner outputs (one JSON object per line):',
    fragments
      .map((fragment) =>
        JSON.stringify({
          kind: fragment.kind,
          content: fragment.content,
          confidence: fragment.confidence,
          authority: fragment.authority,
          materialId: fragment.provenance.materialId,
          source: fragment.provenance.source,
          evidenceSpan: fragment.evidenceSpan ?? null,
          structured: fragment.structured ?? null,
        }),
      )
      .join('\n'),
    '',
    'Group, merge, and rank these fragments. Promote items with confidence >= 0.6 to claims with explicit subject/predicate/object when the kind is factual; otherwise keep them as fragments. Mark contradictions with status="disputed".',
  ].join('\n');

export const createConsolidationAgent = ({
  client,
  prompts,
}: {
  client: LLMClient;
  prompts: PromptBundle;
}): ConsolidationAgent => ({
  async consolidate(fragments, options) {
    if (fragments.length === 0) {
      return { fragments: [], claims: [] };
    }
    const result = await client.generateObject({
      system: prompts.consolidation,
      prompt: buildPrompt(fragments),
      schema: consolidationOutputSchema,
      context: {
        promptId: 'consolidation',
        promptVersion: prompts.promptVersion,
        ...(options?.signal ? { signal: options.signal } : {}),
      },
    });
    return result.object;
  },
});
