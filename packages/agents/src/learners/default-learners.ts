import type { LLMClient } from '../llm/client';
import { type ConcurrencyLimiter, createConcurrencyLimiter } from '../llm/concurrency';
import type { PromptBundle } from '../prompts/load';
import { type LearnerKind, learnerOutputSchemas } from './output-schemas';
import type { LearnedFragment, LearnerAgent, LearnerInvocation, LearningMaterial } from './types';

const LEARNER_KINDS: readonly LearnerKind[] = ['factual', 'style', 'behavior', 'reasoning'];

// Chunk material text so a single learner call stays well under typical
// provider input limits (OpenAI Responses API: 10 MiB) and within the LLM
// context window. 200k chars ≈ 600 KB UTF-8 for Chinese, comfortably
// inside a 128k-token context after system + scaffolding overhead.
const MATERIAL_CHUNK_CHARS = 200_000;

const splitMaterial = (material: LearningMaterial): LearningMaterial[] => {
  const text = material.text ?? '';
  if (text.length <= MATERIAL_CHUNK_CHARS) {
    return [material];
  }
  const chunks: LearningMaterial[] = [];
  let chunkIndex = 0;
  for (let offset = 0; offset < text.length; offset += MATERIAL_CHUNK_CHARS) {
    const slice = text.slice(offset, offset + MATERIAL_CHUNK_CHARS);
    chunks.push({
      ...material,
      id: `${material.id}#chunk-${chunkIndex}`,
      text: slice,
      metadata: {
        ...(material.metadata ?? {}),
        chunkIndex,
        chunkStartChar: offset,
        chunkEndChar: offset + slice.length,
        originalMaterialId: material.id,
      },
    });
    chunkIndex += 1;
  }
  return chunks;
};

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
  const chunks = splitMaterial(material);
  const all: LearnedFragment[] = [];
  for (const chunk of chunks) {
    const results = await Promise.all(
      learners.map((learner) => learner.learn(chunk, invocation)),
    );
    all.push(...results.flat());
  }
  return all;
};

export { LEARNER_KINDS };
