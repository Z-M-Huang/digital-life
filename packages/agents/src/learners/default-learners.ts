import type { LLMClient } from '../llm/client';
import { type ConcurrencyLimiter, createConcurrencyLimiter } from '../llm/concurrency';
import type { PromptBundle } from '../prompts/load';
import { type LearnerKind, learnerOutputSchemas } from './output-schemas';
import type { LearnedFragment, LearnerAgent, LearnerInvocation, LearningMaterial } from './types';

const LEARNER_KINDS: readonly LearnerKind[] = ['factual', 'style', 'behavior', 'reasoning'];

const buildAuthority = (material: LearningMaterial): string => {
  const connectorId =
    typeof material.metadata?.connectorId === 'string'
      ? (material.metadata.connectorId as string)
      : material.source.split('.')[0];
  return connectorId ? `connector:${connectorId}` : `source:${material.source}`;
};

const userPrompt = (material: LearningMaterial): string => {
  return [
    `Material id: ${material.id}`,
    `Source tool: ${material.source}`,
    material.metadata
      ? `Metadata: ${JSON.stringify(material.metadata, null, 2)}`
      : 'Metadata: (none)',
    '',
    'Material text:',
    material.text,
    '',
    'Return a single JSON object matching the provided schema. If nothing applicable is in the material, return { "fragments": [] }.',
  ].join('\n');
};

export type LearnerOptions = {
  client: LLMClient;
  prompts: PromptBundle;
  limiter?: ConcurrencyLimiter;
};

const createLearner = (
  kind: LearnerKind,
  { client, prompts, limiter }: LearnerOptions,
): LearnerAgent => ({
  id: kind,
  async learn(material: LearningMaterial, invocation?: LearnerInvocation) {
    const schema = learnerOutputSchemas[kind];
    const system = prompts[kind];
    const prompt = userPrompt(material);
    const invoke = () =>
      client.generateObject({
        system,
        prompt,
        schema,
        context: {
          promptId: kind,
          promptVersion: prompts.promptVersion,
          ...(invocation?.signal ? { signal: invocation.signal } : {}),
        },
      });

    const result = await (limiter ? limiter.run(invoke) : invoke());
    const authority = buildAuthority(material);

    return result.object.fragments.map((fragment) => {
      const { content, confidence, evidenceSpan, ...structured } = fragment;
      const fragmentRecord: LearnedFragment = {
        kind,
        content,
        confidence,
        authority,
        provenance: {
          source: material.source,
          materialId: material.id,
          ...(material.metadata ? { metadata: material.metadata } : {}),
          extraction: {
            promptVersion: prompts.promptVersion,
            extractionModel: client.modelId,
            extractionVersion: client.extractionVersion,
          },
        },
        ...(evidenceSpan ? { evidenceSpan } : {}),
        ...(Object.keys(structured).length > 0 ? { structured } : {}),
      };
      return fragmentRecord;
    });
  },
});

export const createDefaultLearners = (options: LearnerOptions): LearnerAgent[] => {
  const limiter =
    options.limiter ?? createConcurrencyLimiter(Math.max(1, Math.min(LEARNER_KINDS.length, 4)));
  return LEARNER_KINDS.map((kind) => createLearner(kind, { ...options, limiter }));
};

export const runDefaultLearners = async (
  material: LearningMaterial,
  learners: LearnerAgent[],
  invocation?: LearnerInvocation,
): Promise<LearnedFragment[]> => {
  const results = await Promise.all(learners.map((learner) => learner.learn(material, invocation)));
  return results.flat();
};

export { LEARNER_KINDS };
