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

// Cap each LLM call payload below typical provider input limits.
// Single OpenAI Responses call max input ~10 MB; we leave headroom for the
// system prompt and JSON envelope.
const MAX_PROMPT_BYTES = 4_000_000;
const FALLBACK_BATCH_SIZE = 25;

const chunkFragments = (fragments: LearnedFragment[]): LearnedFragment[][] => {
  if (fragments.length === 0) {
    return [];
  }
  const batches: LearnedFragment[][] = [];
  let current: LearnedFragment[] = [];
  let currentBytes = 0;
  for (const fragment of fragments) {
    const serialized = JSON.stringify({
      kind: fragment.kind,
      content: fragment.content,
      evidenceSpan: fragment.evidenceSpan,
      structured: fragment.structured,
    });
    const fragmentBytes = Buffer.byteLength(serialized, 'utf8');
    if (
      current.length > 0 &&
      (currentBytes + fragmentBytes > MAX_PROMPT_BYTES ||
        current.length >= FALLBACK_BATCH_SIZE)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(fragment);
    currentBytes += fragmentBytes;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
};

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
    const merged: ConsolidationAgentOutput = { fragments: [], claims: [] };
    for (const batch of chunkFragments(fragments)) {
      const result = await client.generateObject({
        system: prompts.consolidation,
        prompt: buildPrompt(batch),
        schema: consolidationOutputSchema,
        context: {
          promptId: 'consolidation',
          promptVersion: prompts.promptVersion,
          ...(options?.signal ? { signal: options.signal } : {}),
        },
      });
      merged.fragments.push(...result.object.fragments);
      merged.claims.push(...result.object.claims);
    }
    return merged;
  },
});
